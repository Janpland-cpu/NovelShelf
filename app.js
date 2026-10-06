(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const app = $("#app");
  const toastEl = $("#toast");

  const state = {
    client: null,
    user: null,
    session: null,
    novels: [],
    currentNovel: null,
    currentChapters: [],
    currentChapter: null,
    editing: false,
    previewing: false,
    saveTimer: null,
    pendingImageTarget: null,
    tts: {
      chunks: [],
      index: 0,
      playing: false,
      paused: false,
      voiceURI: localStorage.getItem("novel.tts.voice") || "",
      rate: Number(localStorage.getItem("novel.tts.rate") || 1)
    }
  };

  const READER_DEFAULTS = {
    fontSize: Number(localStorage.getItem("novel.reader.fontSize") || 19),
    lineHeight: Number(localStorage.getItem("novel.reader.lineHeight") || 1.9),
    width: Number(localStorage.getItem("novel.reader.width") || 760),
    font: localStorage.getItem("novel.reader.font") || "serif"
  };

  function isConfigured() {
    return cfg.supabaseUrl && cfg.supabaseKey &&
      !cfg.supabaseUrl.includes("YOUR_PROJECT") &&
      !cfg.supabaseKey.includes("YOUR_PUBLISHABLE_KEY");
  }

  function toast(message, type = "ok") {
    toastEl.textContent = message;
    toastEl.className = `toast show${type === "error" ? " error" : ""}`;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.className = "toast", 2600);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[ch]);
  }

  function escapeAttr(value = "") {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function safeHttpUrl(url = "") {
    try {
      const u = new URL(url, window.location.href);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  }

  function inlineMarkdown(text = "") {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return out;
  }

  function renderMarkdown(md = "") {
    const lines = String(md).replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        continue;
      }

      const imageMatch = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/i);
      if (imageMatch) {
        flushParagraph();
        const url = safeHttpUrl(imageMatch[2]);
        if (url) {
          const alt = imageMatch[1] || "插图";
          html.push(`<figure><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy"><figcaption>${escapeHtml(alt)}</figcaption></figure>`);
        }
        continue;
      }

      const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (h) {
        flushParagraph();
        const level = h[1].length;
        html.push(`<h${level}>${inlineMarkdown(h[2])}</h${level}>`);
        continue;
      }

      if (/^([-*_])\1{2,}$/.test(trimmed)) {
        flushParagraph();
        html.push("<hr>");
        continue;
      }

      if (trimmed.startsWith("> ")) {
        flushParagraph();
        html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
        continue;
      }

      paragraph.push(line);
    }
    flushParagraph();
    return html.join("\n");
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
    } catch { return ""; }
  }

  function routeParts() {
    return (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  }

  function go(path) {
    location.hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
  }

  function isOwner(record) {
    return Boolean(state.user && record && record.owner_id === state.user.id);
  }

  function pageLoading() {
    app.innerHTML = `<div class="loading skeleton">加载中…</div>`;
  }

  function setupTheme() {
    const saved = localStorage.getItem("novel.theme") || "auto";
    applyTheme(saved);
    $("#themeBtn").addEventListener("click", () => {
      const current = localStorage.getItem("novel.theme") || "auto";
      const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
      localStorage.setItem("novel.theme", next);
      applyTheme(next);
      toast(next === "auto" ? "跟随系统主题" : next === "dark" ? "已切换深色" : "已切换浅色");
    });
  }

  function applyTheme(mode) {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = mode;
  }

  function applyReaderSettings() {
    const root = document.documentElement.style;
    root.setProperty("--reader-font-size", `${READER_DEFAULTS.fontSize}px`);
    root.setProperty("--reader-line-height", String(READER_DEFAULTS.lineHeight));
    root.setProperty("--reader-max-width", `${READER_DEFAULTS.width}px`);
    const fonts = {
      serif: 'ui-serif, "Noto Serif SC", "Songti SC", "Source Han Serif SC", STSong, serif',
      sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    };
    root.setProperty("--reader-font", fonts[READER_DEFAULTS.font] || fonts.serif);

    $("#fontSizeRange").value = READER_DEFAULTS.fontSize;
    $("#lineHeightRange").value = READER_DEFAULTS.lineHeight;
    $("#readerWidthSelect").value = String(READER_DEFAULTS.width);
    $("#readerFontSelect").value = READER_DEFAULTS.font;
    $("#fontSizeOutput").textContent = `${READER_DEFAULTS.fontSize}px`;
    $("#lineHeightOutput").textContent = READER_DEFAULTS.lineHeight.toFixed(1);
  }

  function bindReaderSettings() {
    $("#fontSizeRange").addEventListener("input", e => {
      READER_DEFAULTS.fontSize = Number(e.target.value);
      localStorage.setItem("novel.reader.fontSize", READER_DEFAULTS.fontSize);
      applyReaderSettings();
    });
    $("#lineHeightRange").addEventListener("input", e => {
      READER_DEFAULTS.lineHeight = Number(e.target.value);
      localStorage.setItem("novel.reader.lineHeight", READER_DEFAULTS.lineHeight);
      applyReaderSettings();
    });
    $("#readerWidthSelect").addEventListener("change", e => {
      READER_DEFAULTS.width = Number(e.target.value);
      localStorage.setItem("novel.reader.width", READER_DEFAULTS.width);
      applyReaderSettings();
    });
    $("#readerFontSelect").addEventListener("change", e => {
      READER_DEFAULTS.font = e.target.value;
      localStorage.setItem("novel.reader.font", READER_DEFAULTS.font);
      applyReaderSettings();
    });
  }

  function showSetup() {
    app.innerHTML = `
      <section class="setup-card">
        <p class="eyebrow">首次设置</p>
        <h1>还差 Supabase 配置</h1>
        <p>打开 <code>config.js</code>，填写你的 <strong>Project URL</strong> 和 <strong>Publishable key / anon key</strong>，然后刷新。</p>
        <p>数据库表、RLS 与图片存储桶请先执行项目里的 <code>supabase.sql</code>。</p>
        <p class="muted"><strong>不要</strong>把 secret/service_role key 放进网页。浏览器端只应使用 publishable/anon key。</p>
      </section>`;
  }

  function bindDialogs() {
    document.querySelectorAll("[data-close-dialog]").forEach(btn => btn.addEventListener("click", () => btn.closest("dialog").close()));

    $("#loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      const button = e.submitter;
      button.disabled = true;
      const email = $("#loginEmail").value.trim();
      const password = $("#loginPassword").value;
      const { error } = await state.client.auth.signInWithPassword({ email, password });
      button.disabled = false;
      if (error) return toast(`登录失败：${error.message}`, "error");
      $("#loginDialog").close();
      $("#loginPassword").value = "";
      toast("已登录");
    });

    $("#novelForm").addEventListener("submit", saveNovelFromDialog);
    $("#chapterForm").addEventListener("submit", saveChapterFromDialog);
    $("#imagePicker").addEventListener("change", onImagePicked);
    $("#ttsStopBtn").addEventListener("click", stopTTS);
  }

  function updateAuthButton() {
    const btn = $("#authBtn");
    btn.textContent = state.user ? "退出" : "登录";
    btn.title = state.user ? state.user.email || "退出登录" : "作者登录";
  }

  async function handleAuthButton() {
    if (state.user) {
      stopTTS();
      await state.client.auth.signOut();
      toast("已退出");
    } else {
      $("#loginDialog").showModal();
    }
  }

  function openNovelDialog(novel = null) {
    if (!state.user) return $("#loginDialog").showModal();
    $("#novelDialogTitle").textContent = novel ? "编辑作品" : "新建作品";
    $("#novelId").value = novel?.id || "";
    $("#novelTitle").value = novel?.title || "";
    $("#novelDescription").value = novel?.description || "";
    $("#novelCover").value = novel?.cover_url || "";
    $("#novelStatus").value = novel?.status || "连载中";
    $("#novelPublic").checked = novel?.is_public ?? true;
    $("#novelDialog").showModal();
  }

  async function saveNovelFromDialog(e) {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    const id = $("#novelId").value;
    const title = $("#novelTitle").value.trim();
    const payload = {
      title,
      slug: slugify(title),
      description: $("#novelDescription").value.trim(),
      cover_url: $("#novelCover").value.trim() || null,
      status: $("#novelStatus").value,
      is_public: $("#novelPublic").checked
    };

    let result;
    if (id) result = await state.client.from("novels").update(payload).eq("id", id).select().single();
    else result = await state.client.from("novels").insert(payload).select().single();
    button.disabled = false;

    if (result.error) return toast(`保存失败：${result.error.message}`, "error");
    $("#novelDialog").close();
    toast("作品已保存");
    go(`novel/${result.data.id}`);
    await route();
  }

  function openChapterDialog(chapter = null) {
    if (!state.user || !state.currentNovel || !isOwner(state.currentNovel)) return;
    const nextOrder = state.currentChapters.length ? Math.max(...state.currentChapters.map(c => c.order_index || 0)) + 1 : 1;
    $("#chapterDialogTitle").textContent = chapter ? "编辑章节信息" : "新建章节";
    $("#chapterId").value = chapter?.id || "";
    $("#chapterTitle").value = chapter?.title || `第 ${nextOrder} 章`;
    $("#chapterOrder").value = chapter?.order_index ?? nextOrder;
    $("#chapterPublic").checked = chapter?.is_public ?? true;
    $("#chapterDialog").showModal();
  }

  async function saveChapterFromDialog(e) {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    const id = $("#chapterId").value;
    const payload = {
      novel_id: state.currentNovel.id,
      title: $("#chapterTitle").value.trim(),
      order_index: Number($("#chapterOrder").value),
      is_public: $("#chapterPublic").checked
    };

    let result;
    if (id) result = await state.client.from("chapters").update(payload).eq("id", id).select().single();
    else result = await state.client.from("chapters").insert({ ...payload, content_md: "" }).select().single();
    button.disabled = false;

    if (result.error) return toast(`保存失败：${result.error.message}`, "error");
    $("#chapterDialog").close();
    toast("章节已保存");
    if (!id) go(`chapter/${result.data.id}`);
    else await route();
  }

  function slugify(text) {
    const base = text.trim().toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{Letter}\p{Number}-]+/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `${base || "novel"}-${Date.now().toString(36)}`;
  }

  async function route() {
    if (!state.client) return;
    stopTTS();
    state.editing = false;
    state.previewing = false;
    clearTimeout(state.saveTimer);
    const parts = routeParts();
    pageLoading();
    window.scrollTo({ top: 0, behavior: "instant" });
    try {
      if (!parts.length) return await renderShelf();
      if (parts[0] === "novel" && parts[1]) return await renderNovel(parts[1]);
      if (parts[0] === "chapter" && parts[1]) return await renderChapter(parts[1]);
      app.innerHTML = `<div class="empty-state"><h2>页面不存在</h2><button class="primary-btn" id="goHome404">返回书架</button></div>`;
      $("#goHome404").onclick = () => go("");
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="empty-state"><h2>加载失败</h2><p class="muted">${escapeHtml(err.message || String(err))}</p><button class="secondary-btn" id="retryBtn">重试</button></div>`;
      $("#retryBtn").onclick = route;
    }
  }

  async function renderShelf() {
    const { data, error } = await state.client.from("novels").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    state.novels = data || [];
    const admin = Boolean(state.user);

    app.innerHTML = `
      <section>
        <div class="page-head">
          <div>
            <p class="eyebrow">Library</p>
            <h1>${escapeHtml(cfg.siteTitle || "纸页书架")}</h1>
            <p class="muted">${admin ? "你的作品、草稿与公开书目。" : "公开作品。"}</p>
          </div>
          ${admin ? `<button class="primary-btn" id="newNovelBtn">＋ 新建作品</button>` : ""}
        </div>
        ${state.novels.length ? `<div class="shelf-grid">${state.novels.map(bookCard).join("")}</div>` : `
          <div class="empty-state">
            <h2>${admin ? "书架还是空的" : "暂时没有公开作品"}</h2>
            <p class="muted">${admin ? "创建第一本小说，然后添加章节。" : "稍后再来看看。"}</p>
          </div>`}
      </section>`;

    $("#newNovelBtn")?.addEventListener("click", () => openNovelDialog());
    app.querySelectorAll("[data-novel-id]").forEach(el => el.addEventListener("click", () => go(`novel/${el.dataset.novelId}`)));
  }

  function bookCard(novel) {
    const cover = safeHttpUrl(novel.cover_url || "");
    return `
      <article class="book-card" data-novel-id="${novel.id}" tabindex="0">
        ${cover ? `<img class="book-cover" src="${escapeAttr(cover)}" alt="${escapeAttr(novel.title)}封面" loading="lazy">` : `<div class="book-cover placeholder">${escapeHtml((novel.title || "书").slice(0, 1))}</div>`}
        <div class="book-body">
          <h2>${escapeHtml(novel.title)}</h2>
          <p class="book-desc">${escapeHtml(novel.description || "暂无简介")}</p>
          <div class="meta-row">
            <span class="badge">${escapeHtml(novel.status || "连载中")}</span>
            ${!novel.is_public ? `<span class="badge private">私密</span>` : ""}
            <span>${formatDate(novel.updated_at)}</span>
          </div>
        </div>
      </article>`;
  }

  async function renderNovel(id) {
    const novelRes = await state.client.from("novels").select("*").eq("id", id).single();
    if (novelRes.error) throw novelRes.error;
    const chaptersRes = await state.client.from("chapters").select("*").eq("novel_id", id).order("order_index", { ascending: true });
    if (chaptersRes.error) throw chaptersRes.error;
    state.currentNovel = novelRes.data;
    state.currentChapters = chaptersRes.data || [];
    const owner = isOwner(state.currentNovel);
    const cover = safeHttpUrl(state.currentNovel.cover_url || "");

    app.innerHTML = `
      <section>
        <div class="novel-hero">
          ${cover ? `<img class="novel-cover-large" src="${escapeAttr(cover)}" alt="${escapeAttr(state.currentNovel.title)}封面">` : `<div class="novel-cover-large placeholder">${escapeHtml((state.currentNovel.title || "书").slice(0, 1))}</div>`}
          <div class="novel-summary">
            <p class="eyebrow">${escapeHtml(state.currentNovel.status || "作品")}</p>
            <h1>${escapeHtml(state.currentNovel.title)}</h1>
            <div class="meta-row">
              ${state.currentNovel.is_public ? `<span class="badge">公开</span>` : `<span class="badge private">私密</span>`}
              <span>更新 ${formatDate(state.currentNovel.updated_at)}</span>
            </div>
            <p class="description">${escapeHtml(state.currentNovel.description || "暂无简介")}</p>
            <div class="row-actions">
              <button class="secondary-btn" id="backShelfBtn">← 书架</button>
              ${owner ? `<button class="secondary-btn" id="editNovelBtn">编辑作品</button><button class="primary-btn" id="newChapterBtn">＋ 新章节</button>` : ""}
            </div>
          </div>
        </div>

        <div class="page-head">
          <div><p class="eyebrow">Contents</p><h2>目录</h2></div>
        </div>
        ${state.currentChapters.length ? `<div class="chapter-list">${state.currentChapters.map(chapterRow).join("")}</div>` : `<div class="empty-state"><p>还没有章节。</p></div>`}
        ${owner ? `<div style="margin-top:28px"><button class="danger-ghost-btn" id="deleteNovelBtn">删除整本作品</button></div>` : ""}
      </section>`;

    $("#backShelfBtn").onclick = () => go("");
    $("#editNovelBtn")?.addEventListener("click", () => openNovelDialog(state.currentNovel));
    $("#newChapterBtn")?.addEventListener("click", () => openChapterDialog());
    $("#deleteNovelBtn")?.addEventListener("click", deleteCurrentNovel);
    app.querySelectorAll("[data-chapter-open]").forEach(el => el.addEventListener("click", () => go(`chapter/${el.dataset.chapterOpen}`)));
    app.querySelectorAll("[data-chapter-edit]").forEach(el => el.addEventListener("click", e => {
      e.stopPropagation();
      const chapter = state.currentChapters.find(c => c.id === el.dataset.chapterEdit);
      if (chapter) openChapterDialog(chapter);
    }));
  }

  function chapterRow(chapter) {
    const owner = isOwner(chapter);
    return `
      <div class="chapter-row">
        <div class="chapter-main" data-chapter-open="${chapter.id}" tabindex="0">
          <div class="chapter-title">${escapeHtml(chapter.title)}</div>
          <div class="chapter-meta">序号 ${chapter.order_index} · ${chapter.is_public ? "公开" : "私密"} · ${formatDate(chapter.updated_at)}</div>
        </div>
        ${owner ? `<div class="row-actions"><button class="chip-btn" data-chapter-edit="${chapter.id}">信息</button></div>` : ""}
      </div>`;
  }

  async function deleteCurrentNovel() {
    if (!isOwner(state.currentNovel)) return;
    if (!confirm(`确定删除《${state.currentNovel.title}》以及全部章节吗？此操作不可撤销。`)) return;
    const { error } = await state.client.from("novels").delete().eq("id", state.currentNovel.id);
    if (error) return toast(`删除失败：${error.message}`, "error");
    toast("作品已删除");
    go("");
  }

  async function renderChapter(id) {
    const chapterRes = await state.client.from("chapters").select("*").eq("id", id).single();
    if (chapterRes.error) throw chapterRes.error;
    state.currentChapter = chapterRes.data;

    const novelRes = await state.client.from("novels").select("*").eq("id", state.currentChapter.novel_id).single();
    if (novelRes.error) throw novelRes.error;
    state.currentNovel = novelRes.data;

    const chaptersRes = await state.client.from("chapters").select("id,title,order_index,is_public,owner_id,updated_at,novel_id").eq("novel_id", state.currentNovel.id).order("order_index", { ascending: true });
    if (chaptersRes.error) throw chaptersRes.error;
    state.currentChapters = chaptersRes.data || [];
    renderReader();
    restoreProgress(id);
  }

  function renderReader() {
    const chapter = state.currentChapter;
    const owner = isOwner(chapter);
    const idx = state.currentChapters.findIndex(c => c.id === chapter.id);
    const prev = idx > 0 ? state.currentChapters[idx - 1] : null;
    const next = idx >= 0 && idx < state.currentChapters.length - 1 ? state.currentChapters[idx + 1] : null;

    app.innerHTML = `
      <section class="reader-shell">
        <header class="reader-head">
          <button class="crumb button-reset" id="backToNovel">← ${escapeHtml(state.currentNovel.title)}</button>
          <h1>${escapeHtml(chapter.title)}</h1>
          <p class="muted small">更新 ${formatDate(chapter.updated_at)} ${chapter.is_public ? "" : "· 私密章节"}</p>
        </header>

        <div class="reader-toolbar">
          <button class="chip-btn" id="ttsPlayBtn">▶ 朗读</button>
          <button class="chip-btn" id="ttsSettingsBtn">语音</button>
          <button class="chip-btn" id="readerSettingsBtn">Aa</button>
          <span class="spacer"></span>
          ${owner ? `<button class="chip-btn" id="editToggleBtn">✎ 编辑</button><button class="chip-btn" id="chapterInfoBtn">章节信息</button>` : ""}
        </div>

        <div id="readingMode">
          <article id="readerArticle" class="reader-article">${renderMarkdown(chapter.content_md || "") || `<p class="muted">这一章还没有正文。</p>`}</article>
        </div>

        ${owner ? `
        <div id="editingMode" class="editor-panel hidden">
          <div class="editor-top">
            <button class="secondary-btn" id="insertImageBtn">＋ 插入图片</button>
            <button class="secondary-btn" id="previewBtn">预览</button>
            <button class="primary-btn" id="saveNowBtn">立即保存</button>
            <span id="saveStatus" class="save-status">已同步</span>
          </div>
          <textarea id="chapterEditor" class="editor-textarea" spellcheck="false" aria-label="章节正文">${escapeHtml(chapter.content_md || "")}</textarea>
          <article id="editorPreview" class="reader-article preview-box hidden"></article>
          <div class="editor-help">
            Markdown：<code># 标题</code>、<code>**粗体**</code>、<code>*斜体*</code>、<code>&gt; 引用</code>。图片建议直接点“插入图片”，系统会上传并插入 <code>![说明](图片网址)</code>。
          </div>
          <button class="danger-ghost-btn" id="deleteChapterBtn">删除本章</button>
        </div>` : ""}

        <nav class="reader-nav">
          <button class="secondary-btn" id="prevChapterBtn" ${prev ? "" : "disabled"}>${prev ? `← ${escapeHtml(prev.title)}` : "已经是第一章"}</button>
          <button class="secondary-btn" id="nextChapterBtn" ${next ? "" : "disabled"}>${next ? `${escapeHtml(next.title)} →` : "已经是最后一章"}</button>
        </nav>
      </section>`;

    $("#backToNovel").onclick = () => go(`novel/${state.currentNovel.id}`);
    if (prev) $("#prevChapterBtn").onclick = () => go(`chapter/${prev.id}`);
    if (next) $("#nextChapterBtn").onclick = () => go(`chapter/${next.id}`);
    $("#readerSettingsBtn").onclick = () => $("#readerSettingsDialog").showModal();
    $("#ttsSettingsBtn").onclick = () => { refreshVoices(); $("#ttsDialog").showModal(); };
    $("#ttsPlayBtn").onclick = toggleTTS;

    if (owner) {
      $("#editToggleBtn").onclick = toggleEditor;
      $("#chapterInfoBtn").onclick = () => openChapterDialog(state.currentChapter);
      $("#chapterEditor").addEventListener("input", onEditorInput);
      $("#saveNowBtn").onclick = () => saveCurrentChapter(true);
      $("#insertImageBtn").onclick = () => {
        state.pendingImageTarget = $("#chapterEditor");
        $("#imagePicker").value = "";
        $("#imagePicker").click();
      };
      $("#previewBtn").onclick = togglePreview;
      $("#deleteChapterBtn").onclick = deleteCurrentChapter;
    }
  }

  function toggleEditor() {
    state.editing = !state.editing;
    $("#readingMode").classList.toggle("hidden", state.editing);
    $("#editingMode").classList.toggle("hidden", !state.editing);
    $("#editToggleBtn").textContent = state.editing ? "✓ 阅读" : "✎ 编辑";
    if (!state.editing) {
      const value = $("#chapterEditor").value;
      state.currentChapter.content_md = value;
      $("#readerArticle").innerHTML = renderMarkdown(value) || `<p class="muted">这一章还没有正文。</p>`;
      saveCurrentChapter(false);
    } else {
      setTimeout(() => $("#chapterEditor")?.focus(), 0);
    }
  }

  function onEditorInput() {
    const status = $("#saveStatus");
    if (status) status.textContent = "未保存";
    if (state.previewing) $("#editorPreview").innerHTML = renderMarkdown($("#chapterEditor").value);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveCurrentChapter(false), 900);
  }

  function togglePreview() {
    state.previewing = !state.previewing;
    const editor = $("#chapterEditor");
    const preview = $("#editorPreview");
    if (state.previewing) {
      preview.innerHTML = renderMarkdown(editor.value) || `<p class="muted">暂无内容</p>`;
      editor.classList.add("hidden");
      preview.classList.remove("hidden");
      $("#previewBtn").textContent = "继续编辑";
    } else {
      editor.classList.remove("hidden");
      preview.classList.add("hidden");
      $("#previewBtn").textContent = "预览";
      editor.focus();
    }
  }

  async function saveCurrentChapter(showToast) {
    const editor = $("#chapterEditor");
    if (!editor || !isOwner(state.currentChapter)) return;
    clearTimeout(state.saveTimer);
    const status = $("#saveStatus");
    if (status) status.textContent = "保存中…";
    const content_md = editor.value;
    const { data, error } = await state.client.from("chapters").update({ content_md }).eq("id", state.currentChapter.id).select().single();
    if (error) {
      if (status) status.textContent = "保存失败";
      return toast(`保存失败：${error.message}`, "error");
    }
    state.currentChapter = data;
    if (status) status.textContent = `已保存 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (showToast) toast("正文已保存");
  }

  async function onImagePicked(e) {
    const file = e.target.files?.[0];
    const target = state.pendingImageTarget;
    state.pendingImageTarget = null;
    if (!file || !target || !state.user || !state.currentChapter) return;
    if (!file.type.startsWith("image/")) return toast("请选择图片文件", "error");
    if (file.size > 8 * 1024 * 1024) return toast("建议图片小于 8 MB", "error");

    toast("正在上传图片…");
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || `image-${Date.now()}`;
    const path = `${state.user.id}/${state.currentNovel.id}/${state.currentChapter.id}/${Date.now()}-${safeName}`;
    const { error } = await state.client.storage.from(cfg.storageBucket || "novel-images").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (error) return toast(`图片上传失败：${error.message}`, "error");
    const { data } = state.client.storage.from(cfg.storageBucket || "novel-images").getPublicUrl(path);
    const url = data.publicUrl;
    insertAtCursor(target, `\n![${file.name.replace(/\.[^.]+$/, "")}](${url})\n`);
    target.dispatchEvent(new Event("input"));
    toast("图片已插入正文");
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.setRangeText(text, start, end, "end");
    textarea.focus();
  }

  async function deleteCurrentChapter() {
    if (!isOwner(state.currentChapter)) return;
    if (!confirm(`确定删除“${state.currentChapter.title}”吗？此操作不可撤销。`)) return;
    const { error } = await state.client.from("chapters").delete().eq("id", state.currentChapter.id);
    if (error) return toast(`删除失败：${error.message}`, "error");
    toast("章节已删除");
    go(`novel/${state.currentNovel.id}`);
  }

  function progressKey(id) { return `novel.progress.${id}`; }
  function restoreProgress(id) {
    const y = Number(localStorage.getItem(progressKey(id)) || 0);
    if (y > 0) setTimeout(() => window.scrollTo(0, y), 80);
  }

  let progressTimer = null;
  function bindProgressTracking() {
    window.addEventListener("scroll", () => {
      if (!state.currentChapter || state.editing) return;
      clearTimeout(progressTimer);
      progressTimer = setTimeout(() => localStorage.setItem(progressKey(state.currentChapter.id), String(window.scrollY)), 250);
    }, { passive: true });
  }

  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    const select = $("#ttsVoice");
    const zh = voices.filter(v => /^zh/i.test(v.lang));
    const list = zh.length ? zh : voices;
    select.innerHTML = list.map(v => `<option value="${escapeAttr(v.voiceURI)}">${escapeHtml(v.name)} · ${escapeHtml(v.lang)}</option>`).join("");
    if (state.tts.voiceURI && list.some(v => v.voiceURI === state.tts.voiceURI)) select.value = state.tts.voiceURI;
    $("#ttsRate").value = String(state.tts.rate);
  }

  function splitForSpeech(text) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const pieces = cleaned.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [cleaned];
    const chunks = [];
    let current = "";
    for (const piece of pieces) {
      if ((current + piece).length > 180 && current) {
        chunks.push(current.trim());
        current = piece;
      } else current += piece;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function toggleTTS() {
    if (!("speechSynthesis" in window)) return toast("这个浏览器不支持网页朗读", "error");
    if (state.tts.playing && !state.tts.paused) {
      speechSynthesis.pause();
      state.tts.paused = true;
      $("#ttsPlayBtn").textContent = "▶ 继续";
      return;
    }
    if (state.tts.playing && state.tts.paused) {
      speechSynthesis.resume();
      state.tts.paused = false;
      $("#ttsPlayBtn").textContent = "Ⅱ 暂停";
      return;
    }
    const article = $("#readerArticle");
    const text = `${state.currentChapter?.title || ""}。${article?.innerText || ""}`;
    state.tts.chunks = splitForSpeech(text);
    state.tts.index = 0;
    state.tts.playing = true;
    state.tts.paused = false;
    speakNextChunk();
  }

  function speakNextChunk() {
    if (!state.tts.playing || state.tts.index >= state.tts.chunks.length) {
      stopTTS();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(state.tts.chunks[state.tts.index]);
    utterance.rate = state.tts.rate;
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => v.voiceURI === state.tts.voiceURI) || voices.find(v => /^zh/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => { state.tts.index += 1; speakNextChunk(); };
    utterance.onerror = () => stopTTS();
    speechSynthesis.speak(utterance);
    $("#ttsPlayBtn").textContent = "Ⅱ 暂停";
  }

  function stopTTS() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    state.tts.playing = false;
    state.tts.paused = false;
    state.tts.index = 0;
    const btn = $("#ttsPlayBtn");
    if (btn) btn.textContent = "▶ 朗读";
  }

  function bindTTSControls() {
    if ("speechSynthesis" in window) {
      refreshVoices();
      speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    $("#ttsVoice").addEventListener("change", e => {
      state.tts.voiceURI = e.target.value;
      localStorage.setItem("novel.tts.voice", state.tts.voiceURI);
      if (state.tts.playing) { stopTTS(); toast("语音已更换，请重新开始朗读"); }
    });
    $("#ttsRate").addEventListener("change", e => {
      state.tts.rate = Number(e.target.value);
      localStorage.setItem("novel.tts.rate", state.tts.rate);
      if (state.tts.playing) { stopTTS(); toast("语速已更换，请重新开始朗读"); }
    });
  }

  async function init() {
    $("#siteTitle").textContent = cfg.siteTitle || "纸页书架";
    document.title = cfg.siteTitle || "纸页书架";
    setupTheme();
    applyReaderSettings();
    bindReaderSettings();
    bindDialogs();
    bindTTSControls();
    bindProgressTracking();
    $("#homeBtn").addEventListener("click", () => go(""));
    $("#authBtn").addEventListener("click", handleAuthButton);

    if (!isConfigured()) {
      showSetup();
      return;
    }

    if (!window.supabase?.createClient) {
      app.innerHTML = `<div class="empty-state"><h2>Supabase SDK 加载失败</h2><p class="muted">请检查网络后刷新。</p></div>`;
      return;
    }

    state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data: { session } } = await state.client.auth.getSession();
    state.session = session;
    state.user = session?.user || null;
    updateAuthButton();

    state.client.auth.onAuthStateChange((_event, sessionNow) => {
      state.session = sessionNow;
      state.user = sessionNow?.user || null;
      updateAuthButton();
      setTimeout(route, 0);
    });

    window.addEventListener("hashchange", route);
    await route();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(err => console.warn("Service worker registration failed", err));
    }
  }

  init().catch(err => {
    console.error(err);
    app.innerHTML = `<div class="empty-state"><h2>初始化失败</h2><p class="muted">${escapeHtml(err.message || String(err))}</p></div>`;
  });
})();
