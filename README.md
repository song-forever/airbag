# 跃练 · Airbag Coach

iPhone Safari 优先的单板气垫复盘测试版。纯静态网页，使用 GitHub Pages 托管，无需 Cloudflare、服务器或 Xcode。

## 使用

1. 用 iPhone Safari 打开已发布的 HTTPS 页面，可以添加到主屏幕。
2. 先导入现有 MOV / MP4 视频验证回放；可选择其中 0.5 至 60 秒的一跳。
3. 在设置中填写阿里云百炼北京地域 API Key，按需开启自动分析。Key 只在本次页面内存中，刷新后重新填写，建议使用短期临时 Key。
4. 固定手机在出发点后方，选择直飞、抓板、转体或自定义动作，点击准备。
5. 人物检测首次加载需要时间。跟踪框出现后出发，回来查看回放和分析。

本地拍摄和回看不需要 Key。分析时网页直接将最多 32 张带时间戳的 JPEG 画面发给千问，不上传完整视频，不经过本站中转。手动分析会确认发送与计费；自动分析需先在设置中开启。支持设置中的百炼视频理解模型；按型号适配普通、思考和 Omni 返回方式，只分析助滑、上台、起跳、腾空，不分析落地。页面显示 API 返回用量。只有已配置单价的型号显示免费额度抵扣前的标价估算，其他型号不套用旧单价；实际扣费以百炼账单为准。

## 拍摄和记录

- 固定后方机位，自动锁定目标，用缩小、远离、运动变化和消失延时估计结束；保留手动结束。
- 等待出发期间也录制，默认回放和分析从检测出发前约 1.2 秒开始。下载包含等待部分的原始录像。
- 等待最多 60 秒，检测出发后最多 18 秒。自动结束是估计，不表示落地确认。
- 1/4、1/2、原速回放、片段循环、1/60 秒微步；微步不等同所有原片的精确逐帧。
- 视频和报告存在当前浏览器 IndexedDB；可下载原片、导出 JSON、删除。目标动作在本机记忆。数据按应用路径分开命名。

保持屏幕解锁、页面在前台。切换应用或锁屏会尽力停止并保存，系统强制挂起或关闭时不能保证保存成功。浏览器存储可能被清理，重要录像请另行下载。换域名、换浏览器或从旧测试链接进入新链接，历史不会自动迁移。

## GitHub Pages 部署

仓库：<https://github.com/song-forever/airbag>

1. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
2. main 分支的推送会运行 `.github/workflows/pages.yml`，也可以在 Actions 手动运行。
3. 工作流运行测试、生成 `dist/`、校验资源并部署。成功后使用工作流显示的页面地址。标准项目地址为 `https://song-forever.github.io/airbag/`。

无需填写 GitHub Actions API Key 或其他 Secrets。每位使用者在页面输入自己的千问 Key。检测资源在构建时下载并检查 SHA-256，随页面一起发布；手机无需访问 Google 模型站点或 CDN。首次使用仍需下载资源，不保证离线。

GitHub Free 的 Pages 需要公开仓库；私有仓库需要支持 Pages 的付费方案。仓库私有不表示发布后的 Pages 网站私有，请检查 GitHub 的站点可见性。代码中不包含个人视频或真实 Key。

## 本地开发

Node.js 22+，无 npm 安装依赖。

```sh
npm test
npm run build
npm run validate
npm run dev
```

预览地址为 `http://localhost:4317/airbag/`，与实际项目路径一致。本机 localhost 可以使用相机；手机通过普通局域网 HTTP 访问不能启用相机，请使用已部署的 HTTPS 地址。

维护源码在 `src/`，静态发布内容在 `dist/`，构建脚本在 `scripts/`。首次构建需要访问固定的上游资源，后续可使用校验过的 `work/asset-cache/`。源代码不保存密钥、个人素材或检测二进制，构建产物包含所需二进制和第三方许可。

## 验证与限制

测试覆盖目标关联、遮挡、停止与超时、千问输入校验、错误、取消、结果与费用计算。已使用一段约 6.2 秒、720×1280 MOV 验证导入、解码、慢放和抽取 32 张画面。API 请求流程使用明确的模拟响应测试，尚未使用真实 Key 验证千问结论、实际计费和延迟。

自动检测是实验功能；多人交叉、遮挡、远距离和移动机位会影响关联。iPhone 15 Pro Max 的实际拍摄帧率、发热、检测速度、结束时机及 Safari 直连千问，仍需手机现场验证。抽帧可能错过快速细节，AI 结论只作回看提示。

## 模型选择（2026-10-21）

模型清单在 `src/model-catalog.js`，按厂商与系列分组，包含现行型号和仍在服务的公开快照；已按官方下线公告排除退役型号。参考官方[视觉模型](https://help.aliyun.com/zh/model-studio/vision-model)、[模型上新](https://help.aliyun.com/zh/model-studio/newly-released-models)、[全模态](https://help.aliyun.com/zh/model-studio/qwen-omni)、[Kimi](https://help.aliyun.com/zh/model-studio/kimi-api)、[MiniMax](https://help.aliyun.com/zh/model-studio/minimax-api-by-minimax) 和 [Stepfun](https://help.aliyun.com/zh/model-studio/stepfun)。列表不会实时同步百炼；后续新型号可以选择“其他 / 新增百炼视频模型”填入准确 ID。自定义型号仍只请求固定百炼接口，不允许自定义服务地址。

`glm-5.3` 和 `deepseek-v4-pro-0813` 仅支持文本，列出但禁用。实时通话、视频生成、Embedding 等不同任务不列为逐跳复盘模型。当前用带时间戳的抽帧分析，不包含原视频音频。

模型是否可用、是否需要开通/授权、地域及免费额度是否到期都由百炼管理，网页不能查询或保证免费。只想使用免费额度，请在百炼控制台开启对应模型的“免费额度用完即停”。不自动回退到其他型号。

多模型测试用模拟响应验证各请求分支、流式读取、取消、用量与单价隔离，未消耗用户 Key 或免费额度，也不代表所有型号在此账号已开通。

下线核对：[历史主线](https://www.aliyun.com/notice/118177)、[早批快照](https://www.aliyun.com/notice/118178)、[Omni/VL快照](https://www.aliyun.com/notice/118434)、[VL Flash](https://www.aliyun.com/notice/118344)、[开源VL](https://www.aliyun.com/notice/118345)。因此旧的 Qwen3-VL-Flash、QVQ、Qwen2.5-VL 等退役型号不会出现在可选列表。目录不把“仅支持图像”或“能够生成视频”误标为视频理解。
