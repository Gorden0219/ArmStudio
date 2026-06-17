/* ============================================================
 * codegen.js — 根据模型 + 关键帧生成代码（支持任意 N 关节）
 * Arduino(伺服) / ROS(Python) / 轨迹 JSON
 * ============================================================ */

const CodeGen = (function () {
  const fmt = (n) => +(Math.round(n * 100) / 100).toFixed(2);

  // 取可动关节索引；把关键帧的 q 转成「每帧的关节值」（revolute→度, prismatic→mm）
  function jointTable(model, frames) {
    const mi = model.movableIndices();
    const names = mi.map((i) => model.nodes[i].name.replace(/\s+/g, "_"));
    const types = mi.map((i) => model.nodes[i].joint.type);
    const rows = frames.map((f) =>
      mi.map((i, k) => (types[k] === "prismatic" ? fmt(f.q[i]) : fmt(Kin.deg(f.q[i]))))
    );
    return { mi, names, types, rows };
  }

  function arduino(model, frames) {
    if (!frames.length) return "// 还没有关键帧，请先设计姿态序列。";
    const { names, types, rows } = jointTable(model, frames);
    const useGrip = model.hasGripper;
    const N = names.length + (useGrip ? 1 : 0);
    const toServo = (v, t) => (t === "prismatic" ? Math.max(0, Math.min(180, Math.round(v))) : Math.max(0, Math.min(180, Math.round(v + 90))));
    const poseLines = rows.map((r, i) => {
      const vals = r.map((v, k) => toServo(v, types[k]));
      if (useGrip) vals.push(frames[i].grip === "open" ? 60 : 15);
      return "  {" + vals.join(", ") + "}" + (i < rows.length - 1 ? "," : "");
    }).join("\n");
    const headerNames = names.concat(useGrip ? ["gripper"] : []).join(", ");

    return `/* ArmStudio 自动生成 — ${model.name} (Arduino)
 * ${N} 路伺服: ${headerNames}
 * 依赖: Servo 库
 */
#include <Servo.h>
const int NUM_SERVOS = ${N};
const int SERVO_PINS[NUM_SERVOS] = {${Array.from({ length: N }, (_, i) => i + 2).join(", ")}};
Servo servos[NUM_SERVOS];

// 每行 = 一个关键帧（单位: 度 / mm，已映射到 0~180）
const int NUM_POSES = ${rows.length};
const int poses[NUM_POSES][NUM_SERVOS] = {
${poseLines}
};
int current[NUM_SERVOS];
const int STEP_MS = 1200, SUB = 40;

void writeAll(int v[]) { for (int i=0;i<NUM_SERVOS;i++) servos[i].write(v[i]); }
void moveTo(const int t[]) {
  for (int s=1;s<=SUB;s++){ int tmp[NUM_SERVOS];
    for(int i=0;i<NUM_SERVOS;i++) tmp[i]=current[i]+(t[i]-current[i])*s/SUB;
    writeAll(tmp); delay(STEP_MS/SUB);
  }
  for(int i=0;i<NUM_SERVOS;i++) current[i]=t[i];
}
void setup(){
  for(int i=0;i<NUM_SERVOS;i++){ servos[i].attach(SERVO_PINS[i]); current[i]=poses[0][i]; }
  writeAll(current); delay(800);
}
void loop(){
  for(int p=0;p<NUM_POSES;p++){ int t[NUM_SERVOS];
    for(int i=0;i<NUM_SERVOS;i++) t[i]=poses[p][i]; moveTo(t); delay(250);
  }
}
`;
  }

  function ros(model, frames) {
    if (!frames.length) return "# 还没有关键帧，请先设计姿态序列。";
    const { names, types, rows } = jointTable(model, frames);
    const tStep = 1.5;
    const pos = (r) => r.map((v, k) => (types[k] === "prismatic" ? fmt(v / 1000) : fmt((v * Math.PI) / 180))); // m / rad
    const ptLines = rows.map((r, i) =>
      `        JointTrajectoryPoint(positions=[${pos(r).join(", ")}], time_from_start=rospy.Duration(${fmt((i + 1) * tStep)})),`
    ).join("\n");

    return `#!/usr/bin/env python3
# ArmStudio 自动生成 — ${model.name} (ROS1 / rospy)
# 发布 trajectory_msgs/JointTrajectory
import rospy
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint

JOINT_NAMES = [${names.map((n) => `"${n}"`).join(", ")}]
TOPIC = "/robot_controller/command"   # 按你的控制器修改

def main():
    rospy.init_node("armstudio_traj")
    pub = rospy.Publisher(TOPIC, JointTrajectory, queue_size=1)
    rospy.sleep(1.0)
    traj = JointTrajectory()
    traj.joint_names = JOINT_NAMES
    traj.points = [
${ptLines}
    ]
    traj.header.stamp = rospy.Time.now()
    pub.publish(traj)
    rospy.loginfo("已发送 %d 个关键帧", len(traj.points))
    rospy.sleep(${fmt(rows.length * tStep + 1)})

if __name__ == "__main__":
    try: main()
    except rospy.ROSInterruptException: pass
`;
  }

  function json(model, frames) {
    const { mi, names, types, rows } = jointTable(model, frames);
    return JSON.stringify({
      generator: "ArmStudio",
      robot: model.name,
      joints: names,
      unit: { revolute: "deg", prismatic: "mm" },
      keyframes: frames.map((f, i) => ({
        index: i + 1,
        motion: i === 0 ? "START" : (f.motion || "PTP"),
        speed_mm_s: i === 0 ? undefined : (f.speed || 150),
        acc_mm_s2: i === 0 ? undefined : (f.acc || 600),
        values: rows[i],
        gripper: model.hasGripper ? f.grip : undefined,
      })),
    }, null, 2);
  }

  const ext = { arduino: "ino", ros: "py", json: "json" };
  function generate(lang, model, frames) { return ({ arduino, ros, json })[lang](model, frames); }
  return { generate, ext };
})();
