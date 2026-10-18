# EVEN TONE 0.8.0 · 遮瑕预览

为白癜风与局部肤色差异人群设计的自主遮瑕工具。是否遮盖、遮盖哪里、希望接近什么颜色，都由使用者决定。独立黑客松原型，非品牌官方产品。

网页：https://chnoorlee.github.io/L-Or-al-Hackathon/

## 本次优化

- 照片可放大至 4 倍，并切换拖动模式，便于小斑块取样与修边；确认选区后恢复全图，导出不受缩放影响。
- 独立“拍一张皮肤照片”入口，支持手机系统相机。
- 保存预览接入系统分享菜单；浏览器保留图片下载。
- App 打包网页、算法模型和运行资源；照片局部遮瑕可离线使用，商品官网详情需要联网。
- Android 返回键先关闭弹窗或预览；进入后台关闭实时相机。新增相机用途说明、iOS 隐私清单和项目图标。

## 下载哪个文件

| 文件 | 用途 |
| --- | --- |
| EvenTone-Android.apk | Android 7.0 及以上的签名安装包。下载后由系统安装器打开；系统可能要求允许此来源安装。 |
| EvenTone-Android.aab | 签名的 Android 发布包，供后续应用商店流程使用，不能直接点击安装。 |
| EvenTone-iOS-UNSIGNED.ipa | 已编译的 iPhone / iPad 设备包，但**没有 Apple 签名和描述文件，不能直接安装，也不是 TestFlight 包**。 |
| EvenTone-iOS-Simulator.zip | macOS Xcode iOS 模拟器专用 App，不适用于 iPhone。解压后使用 `xcrun simctl install booted App.app`。 |
| EvenTone-Source.zip | 包含网页源码、Android 工程、iOS Xcode 工程及构建工作流的源代码包。 |
| iOS-Simulator.png | 构建工作流中的模拟器启动截图，不能替代真机验证。 |
| SHA256SUMS.txt | Release 文件完整性校验值。 |

这是预发布版本。构建通过、签名验证和模拟器启动均不能代替真实 Android / iPhone 上的相机、分享、遮瑕效果和性能验收。

## iPhone 签名尚缺什么

目前没有用户提供的 Apple 签名资料，因此不能交付可直接安装的 iPhone 包。需要在 macOS 的 Xcode 中选择你的开发团队，并按开发、Ad Hoc 或 TestFlight 对应流程完成签名和设备/分发配置。不要把证书私钥或密码提交到仓库或聊天。

工程构建（Node.js 24+；iOS 需要 Xcode 26+，目标 iOS 15+）：

```sh
npm ci
npm run web:assets
npm run mobile:sync
npm run mobile:ios
```

在 Xcode 的 App target → Signing & Capabilities 中选择个人团队或开发者团队，必要时更改 Bundle Identifier，再选择连接的 iPhone 执行 Run。App Store / TestFlight 分发另需 Apple Developer 会员及 App Store Connect 配置。

Android 本地构建需要 JDK 21 和 Android SDK 36。`npm run mobile:sync` 后进入 `android` 运行 `./gradlew assembleRelease`。正式签名由 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 环境变量提供；缺少它们时本地 release 构建不带签名。

仓库 Actions → **Build mobile release** 输入与 package.json 一致的版本标签，构建成功后发布到 Release。Android 签名存于仓库 Actions Secrets；本地备份在被 Git 忽略的 `.artifacts/mobile-signing`。请私下备份此目录，升级包需要同一签名。iOS 工作流始终明确输出未签名设备包，不会假装签名成功。

## 隐私与能力边界

相机画面、原始照片、皮肤取样在本机处理，不上传服务器。关闭预览清除当前照片。只有主动导出/分享才生成图片；App 的分享图片暂存于应用私有缓存，下次启动清理，用户自行保存或分享的副本由用户管理。色号收藏只保存商品编号。App 不集成统计或广告 SDK。

照片使用颜色相似度辅助圈选，需手动修整，不识别疾病。预览最长边 640 像素；放大用于精细操作，不增加原始信息。实时模式支持单人全脸底妆与眼下遮瑕，不提供身体斑块实时跟踪。效果为视觉模拟，不代表真实商品遮盖力或治疗效果。

## 依赖说明

采用 Capacitor 8 原生容器，保留现有端侧渲染算法。`xcode` 构建工具的 `uuid` 覆盖为 11.1.1，修复旧版本已知问题；其调用仅使用兼容的 `v4()` 接口。模型和运行资源通过现有 SHA-256 校验脚本准备，未添加云端图像处理。
