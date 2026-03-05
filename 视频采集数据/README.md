# 视频采集数据

从参考视频中提取 HUD 同心环的颜色、半径、逐帧脉动数据，并据此生成帧动画视频。

## 文件结构

```
视频采集数据/
├── analyze_circles.py   # 同心环检测与逐帧追踪
├── generate_video.py    # 纯数据驱动帧动画生成
├── README.md
└── 输出/                # 所有输出文件
    ├── ring_analysis.json   # 分析数据 (JSON)
    ├── ring_analysis.png    # 标注帧截图
    ├── edge_profile.png     # 边缘强度曲线图
    └── generated_hud.mp4    # 生成的帧动画视频
```

## 使用方法

### 1. 分析参考视频

```bash
python 视频采集数据/analyze_circles.py "public/Fairy示例视频.mp4" --sample-every 1 --max-radius 350 --min-radius 30
```

**参数说明：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `video` | (必填) | 参考视频路径 |
| `--sample-every` | 2 | 每N帧采样一次，1=逐帧 |
| `--min-radius` | 15 | 最小检测半径 (px) |
| `--max-radius` | 130 | 最大检测半径 (px)，高清视频需调大 |
| `--min-prom` | 1.5 | 边缘峰值最低突出度 |
| `--center X,Y` | 自动 | 手动指定 HUD 中心坐标 |
| `--out` | 输出/ring_analysis.json | 输出 JSON 路径 |
| `--preview` | 关 | 实时预览窗口 |

**输出：**
- `输出/ring_analysis.json` — 完整分析数据，包含每个分界线的半径、两侧颜色、逐帧 timeline
- `输出/ring_analysis.png` — 标注了检测到的环的帧截图
- `输出/edge_profile.png` — 边缘强度曲线 (Combined/P75/Mean/AngStd/ColorVar)

### 2. 生成帧动画视频

```bash
python 视频采集数据/generate_video.py
```

默认读取 `输出/ring_analysis.json`，生成 `输出/generated_hud.mp4`。

**参数说明：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--data` | 输出/ring_analysis.json | 分析数据 JSON |
| `--out` | 输出/generated_hud.mp4 | 输出视频路径 |
| `--fps` | 源视频帧率 | 覆盖输出帧率 |
| `--width` | 源视频宽度 | 覆盖输出宽度 |
| `--height` | 源视频高度 | 覆盖输出高度 |
| `--preview` | 关 | 实时预览窗口 |

**生成原理：**
- 从 JSON 中每个分界线的两侧颜色构建径向颜色剖面
- 每帧根据 timeline 数据获取当前各分界线半径
- 通过分段线性径向变换 (warp) 实现环的脉动
- 纯数据驱动，无任何硬编码视觉元素

### 示例：完整流程

```bash
# 1. 高清视频逐帧分析
python 视频采集数据/analyze_circles.py "public/Fairy示例视频.mp4" \
  --sample-every 1 --max-radius 350 --min-radius 30

# 2. 生成帧动画
python 视频采集数据/generate_video.py

# 3. 指定不同帧率/尺寸生成
python 视频采集数据/generate_video.py --fps 60 --width 800 --height 600
```

## JSON 数据格式

```jsonc
{
  "video": { "width": 1366, "height": 768, "fps": 25.0, "total_frames": 109 },
  "hud_center": { "x": 686, "y": 376 },
  "rings": [
    {
      "ring_id": 0,
      "ref_radius": 35,           // 参考半径 (px)
      "boundary": "blue(147,83,24) -> blue(147,88,36)",  // 内侧→外侧颜色 (BGR)
      "edge_strength": 3.9,       // 边缘强度
      "radius_avg": 34.6,         // 平均半径
      "radius_min": 32,           // 最小半径
      "radius_max": 40,           // 最大半径
      "motion": "pulsating ~0.5Hz, range 8px",
      "timeline": [35, 35, ...]   // 逐帧半径值
    }
  ]
}
```

## 依赖

```
pip install opencv-python numpy
```
