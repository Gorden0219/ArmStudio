#!/bin/bash

# ArmStudio — 一键上传到 GitHub
# 使用方法：
#   1. 在 GitHub 网页创建新仓库（不要初始化 README/.gitignore）
#   2. 在终端运行: bash push_to_github.command
#   3. 输入你的 GitHub 仓库地址
#

echo "========================================"
echo "  ArmStudio — GitHub 上传工具"
echo "========================================"
echo ""
echo "请先在 GitHub 网页创建一个新仓库（不要勾选任何初始化选项）"
echo ""
read -p "输入你的 GitHub 仓库地址 (例如 https://github.com/用户名/ArmStudio.git): " REPO_URL

if [ -z "$REPO_URL" ]; then
  echo "❌ 仓库地址不能为空"
  exit 1
fi

cd "$(dirname "$0")"

echo ""
echo "📦 初始化 Git 仓库..."
git init

echo ""
echo "📦 添加所有文件..."
git add .

echo ""
echo "📦 创建提交..."
git commit -m "ArmStudio - 机器人控制与轨迹设计工具
- 3D/2D 机器人运动学仿真
- 点击取点与关键帧轨迹设计
- 关节拖拽控制与路点坐标编辑
- CAD 建模：方块/圆柱/球体/拉伸体/多边形/挖孔
- 支持导入 URDF/JSON 自定义机型
- Arduino/ROS 代码生成"

echo ""
echo "🚀 推送到 GitHub..."
git branch -M main
git remote add origin "$REPO_URL"
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 上传成功！"
  echo "   打开 https://github.com 查看你的仓库"
else
  echo ""
  echo "❌ 上传失败，可能原因："
  echo "   - 仓库地址不正确"
  echo "   - 没有配置 GitHub 认证（Token/SSH）"
  echo ""
  echo "请尝试手动运行："
  echo "  git push -u origin main"
fi

echo ""
echo "按回车键退出..."
read
