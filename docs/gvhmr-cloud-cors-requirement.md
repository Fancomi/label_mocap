# GVHMR 云端服务需修复:CORS 跨域响应头

## 问题
Web 标注器(浏览器)直连调用 `POST http://10.52.104.78:8666/gvhmr/infer` 时,
请求被浏览器同源策略拦截,前端 `fetch` 直接报网络错误,拿不到任何响应。

用 `curl` 测试服务是正常的(返回 200 + 正确 JSON),因为 curl 不执行浏览器的
同源策略 (CORS)。问题纯粹在于服务**没有返回 CORS 响应头**,浏览器据此拒绝把
跨源响应交给页面。

实测预检结果:`OPTIONS /gvhmr/infer` 返回 `200 OK`,但响应头里
**没有任何 `Access-Control-Allow-*` 字段**。

## 需要云端做的修改(Flask / Werkzeug)

方案一(推荐,装 flask-cors):
```bash
pip install flask-cors
```
```python
from flask_cors import CORS
CORS(app)   # demo 阶段允许所有来源;收紧可用 resources={r"/gvhmr/*": {"origins": "*"}}
```

方案二(不装依赖,手写 after_request + 处理 OPTIONS 预检):
```python
@app.after_request
def add_cors_headers(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return resp

# 确保 /gvhmr/infer 路由同时接受 OPTIONS(预检),直接返回 200 即可:
# @app.route('/gvhmr/infer', methods=['POST', 'OPTIONS'])
```

## 验证(改完后,在我的机器上跑这条应能看到 CORS 头)
```bash
curl -i -X OPTIONS "http://10.52.104.78:8666/gvhmr/infer" \
  -H "Origin: http://127.0.0.1:5175" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```
期望响应头里出现:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```
出现这三行后,浏览器端推理即可正常返回结果。

## 备注
- 接口的请求/响应体格式不需要改,只加响应头。
- demo / 内网阶段用 `*` 即可;若日后上公网,把 `Allow-Origin` 收紧到具体页面来源。
