# 网页试妆与 GitHub Pages 部署

网站：<https://chnoorlee.github.io/L-Or-al-Hackathon/>

源码：<https://github.com/chnoorlee/L-Or-al-Hackathon>

## 手机使用

1. 在 iPhone Safari 或 Android Chrome 中打开网站。微信内置浏览器若无法启动相机，请通过菜单在系统浏览器中打开。
2. 点「打开实时镜头」并允许相机。首次下载模型会显示进度，需要保持网络连接。
3. 选「唇膏」和「300 Le Rouge Paris」，左右移动脸部、张嘴，再切换色号，检查贴合情况。
4. 可选择粉底等商品叠妆、分屏比较、移除图层或保存图片；也可上传本机照片试妆。

照片和相机画面在当前设备内处理，不发送到服务器。GitHub Pages 仅托管静态网页、公开商品数据与模型；浏览器会向托管站点下载这些文件。收藏只保存商品选择，不保存人脸。首次模型初始化最多等待 180 秒，超时可检查网络后点「重新尝试」。真实手机效果与帧率需要在具体设备上验收。

## 自动发布

工作流：`.github/workflows/pages.yml`。`main` 的推送或手动运行会依次：

1. 使用 Node.js 24 和 `npm ci` 安装锁定依赖。
2. 执行类型检查与单元测试。
3. 下载并校验固定 SHA-256 的面部、头发模型，复制 MediaPipe 运行时和许可证。
4. 使用 Pages 提供的 `base_path` 构建，确保脚本、Worker、模型与首页链接都位于仓库子路径下。
5. 仅将 `dist/web` 部署到 Pages；源码、测试、调试记录与凭据不进入网站制品。

模型与依赖不直接存入 Git，由构建过程准备。源码仓库保留原有许可证。后续改动执行以下检查后，提交并推送到 `main`，在仓库 Actions 中确认部署完成即可：

```powershell
npm ci
npm run verify
npm run web:assets
npm run web:build -- --base /L-Or-al-Hackathon/
npm run web:preview -- --host 127.0.0.1 --base /L-Or-al-Hackathon/
```

本地预览地址为 `http://localhost:5173/L-Or-al-Hackathon/`。本地开发默认根路径可继续用 `npm run web:dev`。不要把带仓库子路径的构建交给仅支持根路径的 `web:serve`；需要该服务时，先重新运行不带 `--base` 的 `npm run web:build`。

若发布后有回归，使用 `git revert` 撤销对应提交并推送，工作流会重新部署；不需要重写 Git 历史。构建和发布失败时先看 Actions 的失败步骤。

## 与此前临时预览的区别

GitHub Pages 地址不依赖本机开机、Cloudflare 隧道或临时二维码，保留仓库及 Pages 配置即可继续访问。此前的 `trycloudflare.com` 地址属于临时测试入口，不再作为主要入口。

部署方案参考 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 与 [Vite 子路径部署](https://vite.dev/guide/static-deploy.html#github-pages)。
