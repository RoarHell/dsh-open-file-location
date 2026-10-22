# dsh-open-file-location

给 **DSH 桌面版**聊天里的文件引用加上「打开文件位置」。

对应的是正文里的这种引用（不是底部交付卡片）：

```text
另外 📄 候选-可能该回.txt 是我之前过完一遍后挑出的 ……
```

点击文件名仍走原来的侧边栏预览；本插件只补「在资源管理器 / 访达里定位」。

## 别人怎么装（照抄即可）

前提：装好 **DSH 桌面版**，并知道自己的 profile 名（桌面版一般是 `desktop`）。

### Windows（PowerShell）

```powershell
dsh plugin --profile desktop add github:RoarHell/dsh-open-file-location
```

### macOS / Linux

```bash
dsh plugin --profile desktop add github:RoarHell/dsh-open-file-location
```

装完 **完全退出并重启 DSH 桌面版**。在「插件」列表里应出现 **dsh-open-file-location**，且开关为开。

说明：

- 若你的 profile 不叫 `desktop`，把命令里的 `desktop` 换成你的 profile 名。
- 没有 `dsh` 命令时，用绝对路径找到 CLI 再执行，例如：  
  `C:\Users\<你>\AppData\Local\Programs\DSH NEXT\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js`
- 若 `dsh plugin` 报 desktop 被 Electron 托管，可在 DSH 桌面版的「插件管理 / Community Market」里搜索或手动安装本仓库。

### 卸载

```powershell
dsh plugin --profile desktop remove dsh-open-file-location
```

### 本地目录安装（开发用）

```powershell
dsh plugin --profile desktop add F:\DSH\plugins\dsh-open-file-location
```

## 用法

| 操作 | 行为 |
| --- | --- |
| **右键** 文件名 | 菜单：「打开文件位置」「在侧边栏预览」 |
| **悬停** 文件名 | 右侧出现小文件夹按钮，一点即定位 |

## 目录结构

```text
dsh-open-file-location/
├── package.json         # dsh.bundle 声明
├── cordis.patch.yml     # 插件层补丁
├── index.js             # Host 半边（空 apply）
├── client.js            # 浏览器半边：右键菜单 + 悬停按钮
└── README.md
```

所有文件都在本文件夹内，不改动 deepseek-harness 源码。

## 实现要点

- 识别文件引用：按钮 / 链接上的 `title` 是完整路径，不依赖会被 CSS Modules 哈希的 class。
- 相对路径按当前会话 `cwd` 拼成绝对路径后，调用 `session.openWorkspacePath({ path, action: 'reveal' })`。
- 桌面不可用、路径无效或 Host 拒绝时，底部提示「无法打开文件位置，请重试」。

## 已知限制

- 只覆盖聊天正文里的文件名按钮 / 本地文件链接；底部交付卡片已自带「显示文件位置」。
- 超长路径、含换行的 `title` 不会被当成文件引用。
- 会话 `cwd` 取不到时，相对路径可能定位失败。
