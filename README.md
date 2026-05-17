# Sky Monitor API

Sky Monitor API 是一个面向位置感知观星助手的 FastAPI 后端。它根据用户 GPS 坐标和观测时间，计算当前位置可见的亮星、太阳系行星和知名深空天体，并返回适合前端绘制星图和大语言模型生成观星建议的结构化 JSON。

当前线上示例服务：

- API: <https://sky.eunoia.top>
- Wiki: <https://sky.eunoia.top/wiki>
- OpenAPI: <https://sky.eunoia.top/openapi.json>
- Health: <https://sky.eunoia.top/health>

## 功能特性

- 基于 GPS 坐标计算地平坐标系下的高度角和方位角。
- 默认筛选高度角大于等于 15 度、亮度适合展示的目标。
- 恒星星表来自 HYG Database，可构建本地 SQLite 星表。
- 行星位置通过 Skyfield + JPL DE421 星历计算。
- 内置常见 Messier/NGC 深空天体清单，包含星团、星云、星系。
- `/sky/chart` 返回 `chart_x`、`chart_y`、`chart_radius`，方便前端直接绘制极坐标星图。
- `reasoning_context` 提供中文推理语料、观测建议和目标解释，便于 LLM 工具调用。
- 静态 Wiki 包含星空风格交互演示，支持城市解析、文件上传、星图缩放、旋转、拖拽和时间前进/后退。
- OpenAPI `servers` 可通过环境变量配置，适合接入灵珠等只接受 HTTPS 域名的工具平台。

## 项目结构

```text
app/
  main.py                 FastAPI 入口和 API 路由
  astronomy.py            天文计算、筛选和星图投影
  catalog_query.py        SQLite 星表查询
  deep_sky.py             知名深空天体清单
  reasoning_corpus.py     推理语料加载和上下文生成
data/
  reasoning_corpus.json   可提交的中文观测语料
scripts/
  download_hyg.py         下载 HYG 恒星星表
  build_catalog_db.py     构建 SQLite 星表
  download_ephemeris.py   下载 JPL DE421 星历
  build_city_index.py     构建 Wiki 城市坐标索引
site/
  wiki/                   星空 Wiki 和交互演示
  api/                    API 调用说明页
tests/                    单元测试
deploy/                   systemd 和 nginx 示例
```

## 快速开始

推荐 Python 3.10 或更高版本。

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

构建运行所需数据：

```bash
python scripts/download_hyg.py
python scripts/build_catalog_db.py
python scripts/download_ephemeris.py
python scripts/build_city_index.py
```

启动服务：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

打开：

- <http://127.0.0.1:8000/health>
- <http://127.0.0.1:8000/docs>
- <http://127.0.0.1:8000/sky/chart?latitude=31.4591&longitude=121.1298&total_limit=8>

## 数据文件说明

仓库不直接提交以下生成或第三方数据文件：

- `data/raw/hygdata_v3.csv`
- `data/catalog.db`
- `data/de421.bsp`
- `site/wiki/cities.tsv`

这些文件可以通过 `scripts/` 下的脚本生成。这样可以保持仓库体积可控，并避免把第三方数据镜像进 Git 历史。

数据来源：

- HYG Database: 恒星基础星表。
- JPL DE421: 太阳系行星星历。
- GeoNames cities1000: Wiki 城市名称到坐标的浏览器侧索引。

## 环境变量

可以复制 `.env.example` 作为部署参考：

```bash
cp .env.example .env
```

当前支持：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SKY_CATALOG_DB` | `data/catalog.db` | SQLite 星表路径 |
| `SKY_PUBLIC_BASE_URL` | `https://sky.eunoia.top` | OpenAPI `servers[0].url` |

本地开发时可以设置：

```bash
export SKY_PUBLIC_BASE_URL=http://127.0.0.1:8000
export SKY_CATALOG_DB=data/catalog.db
```

## 核心 API

### 健康检查

```bash
curl "https://sky.eunoia.top/health"
```

示例返回：

```json
{
  "status": "ok",
  "version": "0.3.1",
  "catalog_db_exists": true
}
```

### 生成星图

GET 调用：

```bash
curl "https://sky.eunoia.top/sky/chart?latitude=31.4591&longitude=121.1298&total_limit=8"
```

POST 调用：

```bash
curl -X POST "https://sky.eunoia.top/sky/chart" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 31.4591,
    "longitude": 121.1298,
    "min_altitude_deg": 15,
    "max_magnitude": 3,
    "deep_sky_max_mag": 9,
    "total_limit": 28
  }'
```

关键返回结构：

```json
{
  "sky_chart": {
    "observer": {
      "lat": 31.4591,
      "lon": 121.1298
    },
    "time_utc": "2026-05-17T03:00:00Z",
    "coordinate_system": {
      "chart_projection": "polar_azimuthal_horizon"
    },
    "counts": {
      "star": 7,
      "planet": 1
    },
    "objects": [
      {
        "category": "star",
        "display_name": "南河三",
        "azimuth_deg": 242.65,
        "altitude_deg": 44.83,
        "magnitude": 0.4,
        "chart_x": -0.4965,
        "chart_y": -0.2567,
        "chart_radius": 0.5019
      }
    ],
    "reasoning_context": {
      "corpus_version": "0.1.0",
      "summary": "当前位置纬度 31.4591、经度 121.1298，本次筛选得到 8 个适合星图展示的目标。",
      "bullets": [],
      "object_insights": []
    }
  }
}
```

### 获取推理语料

```bash
curl "https://sky.eunoia.top/reasoning/corpus"
```

该接口返回用于生成 `reasoning_context` 的中文观测规则、类别建议、目标事实和 LLM 提示注意事项。

### 星表辅助接口

```bash
curl "https://sky.eunoia.top/catalog/stats"
curl "https://sky.eunoia.top/stars/bright?limit=20"
curl "https://sky.eunoia.top/stars/search?name=Sirius"
```

## 前端 Wiki

`site/wiki/index.html` 是已构建好的静态 Wiki 页面，可通过 Nginx 静态托管。

它包含：

- 项目说明和调用方式。
- 城市/坐标输入解析。
- 文件上传坐标解析。
- 浏览器定位。
- 调用 `/sky/chart` 的完整流程演示。
- 可交互星图：缩放、旋转、拖拽、时间前进/后退、点击目标详情。

如果需要城市名称解析，请先生成：

```bash
python scripts/build_city_index.py
```

生成结果为：

```text
site/wiki/cities.tsv
```

## 灵珠平台接入

推荐导入 OpenAPI：

```text
https://sky.eunoia.top/openapi.json
```

工具主动作建议选择：

```text
GET /sky/chart
```

参数最小集合：

| 参数 | 位置 | 类型 | 说明 |
| --- | --- | --- | --- |
| `latitude` | Query | number | GPS 纬度 |
| `longitude` | Query | number | GPS 经度 |

平台只传 GPS 坐标即可，其他筛选参数由后端默认值处理。

## 部署参考

systemd 示例：

```bash
sudo cp deploy/lingzhuback.service /etc/systemd/system/lingzhuback.service
sudo systemctl daemon-reload
sudo systemctl enable --now lingzhuback
```

Nginx 示例：

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/sky-monitor-api
sudo ln -s /etc/nginx/sites-available/sky-monitor-api /etc/nginx/sites-enabled/sky-monitor-api
sudo nginx -t
sudo systemctl reload nginx
```

线上部署时建议：

- 使用 HTTPS 域名访问，不暴露裸 IP 加端口。
- 设置 `SKY_PUBLIC_BASE_URL=https://your-domain.example`，保证 OpenAPI 不返回错误域名。
- 将 `site/wiki/` 发布到 Nginx 静态目录。
- 将 FastAPI 绑定在 `127.0.0.1:8000`，由 Nginx 反向代理。

## 测试

```bash
pytest -q
```

当前测试覆盖：

- 请求模型别名兼容。
- HYG CSV 到 SQLite 的构建逻辑。
- 星表查询排序和过滤。
- 推理语料加载和上下文生成。

## 许可证

本项目代码采用 MIT License。第三方数据集和星历文件遵循各自来源的许可或使用条款，仓库默认不重新分发这些数据文件。
