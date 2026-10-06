# 纸页书架

一个可以直接部署到 **GitHub Pages** 的个人网文 / 轻小说阅读与编辑站。

它把 GitHub Pages 当成静态前端，把小说正文、账号和图片放在 Supabase。这样编辑正文时不需要 Git commit，也不需要等待 Pages 重新构建：在手机上打开章节，点“编辑”，输入后约 0.9 秒自动保存。

## 已包含

- 公开书架与作品简介
- 章节目录、上一章 / 下一章
- 作者邮箱密码登录
- 同页面阅读 / 编辑切换
- 0.9 秒自动保存 + “立即保存”
- Markdown 正文
- 从手机相册上传图片并自动插入正文
- 深色模式
- 字号、行距、阅读宽度、字体设置
- 浏览器原生 TTS 朗读、暂停、语速与音色选择
- 每章阅读位置本地保存
- 作品 / 章节公开或私密
- 手机适配
- PWA 基础壳，可“添加到主屏幕”
- Supabase RLS：访客只读公开内容，登录作者只能修改自己的数据
- 无封面 / 封面地址失效时自动显示默认封面
- 内置 3 本《文学少年》版本：V1、V2、V3；作者首次登录后自动导入 Supabase

## 目录

```text
novel-shelf/
├─ index.html
├─ styles.css
├─ app.js
├─ config.js
├─ supabase.sql
├─ manifest.webmanifest
├─ sw.js
├─ .nojekyll
├─ data/
│  └─ seed-library.json
└─ assets/
   └─ icon.svg
```

---


## 内置《文学少年》书籍

当前包内置三本作品数据：

- `文学少年 V1`：第一卷《文学少年与等待渡船的人》+ 第二卷《文学少年与没有人杀死的她》
- `文学少年 V2`：《文学少年与等待渡船的人》完整初稿
- `文学少年 V3`：《文学少年与等待渡船的人》轻小说重构版

**不需要再次执行 `supabase.sql`。**

部署新文件后，用作者账号打开网站并登录一次。书架会自动检查 `data/seed-library.json`，把缺少的内置书籍和章节写入 Supabase。完成以后，未登录访客也能正常看到公开书籍。

如果以后想重新检查是否漏了章节，作者登录后点书架右上角的 **“检查内置书籍”**。它只补缺少的固定章节，不会覆盖你已经修改过的正文。

默认封面也在这一版启用：新建作品时封面 URL 可以直接留空；如果填写的封面链接以后失效，页面会自动退回默认封面，不再显示破图。

---

## 1. 创建 Supabase 项目

在 Supabase 创建一个项目。

进入 SQL Editor，把 `supabase.sql` **完整执行一次**。它会建立：

- `novels`
- `chapters`
- RLS Policies
- `novel-images` 公开图片 bucket
- 图片上传权限

### 建立作者账号

这个前端故意没有“注册”按钮。

请在 Supabase 的 Authentication / Users 页面创建你自己的邮箱密码账号。为了做单作者站，建议同时关闭公开注册（如果你的项目默认允许）。

---

## 2. 填写 config.js

打开 `config.js`：

```js
window.APP_CONFIG = {
  siteTitle: "纸页书架",
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseKey: "YOUR_PUBLISHABLE_KEY",
  storageBucket: "novel-images"
};
```

替换：

- `supabaseUrl` → 你的 Project URL
- `supabaseKey` → 你的 **Publishable key**（旧项目可能显示 anon key）

### 安全警告

浏览器里的 `config.js` 一定会被访客看到，这是正常的；安全边界是数据库的 RLS。

**绝对不要**把以下内容放进网页：

- `sb_secret_...`
- `service_role`
- 任何 secret key

---

## 3. 本地测试

不要直接双击 `index.html`（service worker / 某些浏览器权限在 `file://` 下可能不正常）。

任选一个简单 HTTP server，例如：

```bash
python -m http.server 8080
```

然后浏览器打开：

```text
http://localhost:8080
```

---

## 4. 部署 GitHub Pages

1. 新建 GitHub 仓库。
2. 把本目录的全部文件放到仓库根目录。
3. GitHub 仓库 → **Settings → Pages**。
4. Source 选择 **Deploy from a branch**。
5. Branch 选 `main`，目录选 `/(root)`。
6. 保存。

这个站点使用 hash 路由（`#/chapter/...`），所以部署在 `用户名.github.io/仓库名/` 也不需要额外改 base path。

---

## 5. 日常用法

### 新建小说

登录 → “新建作品” → 填写书名 / 简介 / 状态。封面 URL 可以留空，系统会显示默认封面。

### 新建章节

进入作品 → “新章节”。

### 手机直接改正文

进入章节 → “编辑” → 输入正文。

停止输入约 0.9 秒后会自动保存；也可以点“立即保存”。切回“阅读”会立即用新正文渲染，不需要 GitHub Pages 重新部署。

### 插入图片

编辑章节 → “插入图片” → 从手机选择图片。

图片会上传到 Supabase Storage，并在光标处插入：

```md
![图片说明](https://...)
```

### Markdown 支持

当前内置的是轻量、安全的小说常用子集：

```md
# 一级标题
## 二级标题
### 三级标题

**粗体**
*斜体*
~~删除线~~

> 引用

---

![插图](https://example.com/image.jpg)
```

普通连续文本会按段落显示。

---

## 6. TTS 朗读

章节页点“朗读”。

它使用浏览器原生 `speechSynthesis`：

- 不需要额外 API key
- 正文修改后可以马上朗读
- 音色取决于手机系统 / 浏览器
- 可以暂停、继续、停止、调语速、选择系统可用中文语音

如果以后要更像有声书的 AI 音色，可以在此基础上增加服务端 TTS（例如生成 mp3 后放对象存储），但那需要额外 API 和费用；当前版本没有把任何付费 TTS 写死进去。

---

## 7. 公私权限

- 未登录访客：只能读取 `is_public = true` 的作品和公开章节。
- 作者登录：可以读取和编辑自己的公开 / 私密作品与章节。
- 图片 bucket 当前是公开 bucket，因此**已经上传的图片 URL 本身是公开可访问的**。

因此如果你打算存严格私密或有版权限制的扫描图 / 插图，不要使用当前 public bucket 方案。那种需求应该改成 private bucket + signed URL。

---

## 8. 当前版本的边界

这是偏“个人 CMS / 阅读器”的版本，不是多人创作平台。它目前没有：

- 多作者权限管理
- 评论系统
- 云端跨设备阅读进度同步（当前阅读进度存浏览器 localStorage）
- AI TTS 音频生成
- EPUB 导入 / 导出
- 章节历史版本 UI

这些都可以在现有数据模型上继续加。

## 建议的下一步

最值得继续做的通常是：

1. **EPUB 导入 / 导出**
2. **全文搜索**
3. **云端书签与阅读进度**
4. **私密图片 signed URL**
5. **章节版本历史 / 恢复**
6. **真正 AI TTS，自动按章节生成音频**
