# dsh-open-file-location

给 **DSH 桌面版**聊天里的文件引用加上「打开文件位置」。

对应的是正文里的这种引用（不是底部交付卡片）：

```text
另外 📄 候选-可能该回.txt 是我之前过完一遍后挑出的 ……
```

点击文件名仍走原来的侧边栏预览；本插件只补「在资源管理器 / 访达里定位」这一条路。

## 用法

| 操作 | 行为 |
| --- | --- |
| **右键** 文件名 | 菜单：「打开文件位置」「在侧边栏预览」 |
| **悬停** 文件名 | 右侧出现小文件夹按钮，一点即定位 |

## 安装

在 **DSH 桌面版**对应的 profile 下安装本目录（需已装 `dsh` CLI）：

```powershell
# Windows
dsh plugin --profile <你的profile> add F:\DSH\plugins\dsh-open-file-location
```

```bash
# macOS / Linux
dsh plugin --profile <你的profile> add /path/to/dsh-open-file-location
```

装完**重启** DSH 桌面版（或重载 profile）后生效。卸载：

```powershell
dsh plugin --profile <你的profile> remove dsh-open-file-location
```

## 目录结构

```text
dsh-open-file-location/
├── package.json         # dsh.bundle 声明
├── cordis.patch.yml     # 插件层补丁
├── index.js             # Host 半边（空 apply）
├── client.js            # 浏览器半边：右键菜单 + 悬停按钮
└── README.md
```

**所有文件都在本文件夹内**，不改动 `deepseek-harness` 源码，不污染工作区根目录。

## 实现要点

- 识别文件引用：按钮 / 链接上的 `title` 是完整路径（DSH Markdown 文件引用约定），不依赖会被 CSS Modules 哈希的 class。
- 相对路径会按当前会话 `cwd` 拼成绝对路径后，调用 `session.openWorkspacePath({ path, action: 'reveal' })`。
- 桌面不可用、路径无效或 Host 拒绝时，页面底部会弹出「无法打开文件位置，请重试」。

## 已知限制

- 只覆盖聊天正文里的文件名按钮 / 本地文件链接；底部交付卡片本身已自带「显示文件位置」，不需要本插件。
- 超长路径、含换行的 `title` 不会被当成文件引用。
- 若会话 `cwd` 取不到，相对路径会原样交给 Host，可能定位失败。
