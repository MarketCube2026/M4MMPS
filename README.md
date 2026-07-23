# 学术会议策划小助手

面向市场部会议策划场景的前后端分离 MVP。用户填写会议基础需求后，系统可生成结构化会议主题、会议概览、日程安排、讲题、嘉宾角色和圆桌讨论议题，并支持编辑、自动保存、时间顺延、嘉宾维护和 Excel 导出。

## 在线访问与下载

- GitHub 仓库：https://github.com/MarketCube2026/M4MMPS
- GitHub Pages 入口：https://marketcube2026.github.io/M4MMPS/
- 项目 ZIP 下载：https://github.com/MarketCube2026/M4MMPS/archive/refs/heads/main.zip

说明：GitHub Pages 只能托管静态页面，完整应用依赖 FastAPI、SQLite 和 openpyxl，需要按下方步骤在本地启动后使用。

## 技术栈

- 前端：React + TypeScript + Ant Design + Vite
- 后端：Python FastAPI
- 数据库：SQLite
- Excel 导出：openpyxl
- AI 生成：MVP 阶段使用规则模板输出结构化 JSON，后续可替换为 OpenAI API

## 目录结构

```text
backend/   FastAPI 服务、SQLite 数据库、Excel 导出、单元测试
frontend/  React + Ant Design 前端应用
docs/      GitHub Pages 静态访问页
index.html 早期单页原型，保留作参考
```

## 启动后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

后端健康检查：

```text
http://127.0.0.1:8000/api/health
```

## 启动前端

```powershell
cd frontend
npm install
npm run dev
```

前端访问地址：

```text
http://127.0.0.1:5173
```

## 使用流程

1. 填写会议基础需求。
2. 点击“保存会议”。
3. 点击“生成策划”，系统生成结构化日程。
4. 在“日程安排”中切换编辑版/视图版，维护环节、讲题、嘉宾、时间和备注。
5. 修改某一环节时间或时长后，后续环节会自动顺延。
6. 在“参会嘉宾”中维护嘉宾姓名、省份、城市、医院、科室、职务、参会角色、提名理由和备注。
7. 嘉宾信息更新后会同步填充到日程中的主持人、讲者和讨论嘉宾字段。
8. 点击“导出 Excel”，下载包含“正式日程表、嘉宾任务表、策划说明表”的工作簿。

## 测试

```powershell
cd backend
$env:PYTHONPATH="."
python -m unittest discover -s tests
```

前端构建：

```powershell
cd frontend
npm run build
```

## MVP 验收点

- 可以本地运行前后端。
- 前后端能够通过 `/api` 正常通信。
- 可以建立、保存和修改会议。
- 可以生成一份完整的半天会议日程。
- 可以新增、删除、调整日程顺序。
- 修改时间或时长后可以自动顺延后续时间。
- 可以维护参会嘉宾，并同步到日程。
- 可以执行规则检查。
- 可以导出格式正确的 Excel。
