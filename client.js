/**
 * open-file-location · Client half
 *
 * Chat file references gain:
 *   1. Right-click menu "打开文件位置"
 *   2. Hover folder chip that reveals the file immediately
 *
 * File chips/links carry `title` = path (Markdown render convention).
 */
window.__ModuleLoader__.load({
  id: 'dsh-open-file-location',
  factory(require) {
    const LABEL = {
      reveal: '打开文件位置',
      revealFail: '无法打开文件位置，请重试',
      openPreview: '在侧边栏预览',
    }

    function looksLikePath(title) {
      if (typeof title !== 'string' || title.length === 0) return false
      if (title.includes('\n') || title.includes('\r')) return false
      if (/^[a-z][a-z0-9+.-]*:/i.test(title) && !/^file:/i.test(title)) return false
      if (/[\\/]/.test(title)) return true
      return /\.[A-Za-z0-9]{1,8}$/.test(title)
    }

    /** Strip #L12 / #L12-L20 suffixes and file:// wrappers. */
    function cleanPath(raw) {
      let p = String(raw ?? '').trim()
      if (p.startsWith('file://')) {
        try { p = decodeURIComponent(p.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '')) } catch (_e) { /* keep */ }
      }
      p = p.replace(/#L\d+(?:-L?\d+)?$/i, '')
      return p
    }

    function isAbsolute(p) {
      return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
    }

    function joinPath(cwd, rel) {
      const sep = cwd.includes('\\') ? '\\' : '/'
      const left = cwd.replace(/[\\/]+$/, '')
      const right = rel.replace(/^[.][\\/]+/, '').replace(/^[\\/]+/, '')
      return left + sep + right
    }

    function normalizeForWindows(p) {
      return p.replace(/\//g, '\\')
    }

    /** Every session cwd currently projected — list snapshot has no "current" flag. */
    function collectCwds(context) {
      const out = []
      const push = (cwd) => {
        if (typeof cwd === 'string' && cwd.length > 0 && !out.includes(cwd)) out.push(cwd)
      }
      try {
        const snap = context.sessions?.list?.getSnapshot?.()
        if (snap != null) {
          for (const id of snap.ids ?? Object.keys(snap.byId ?? {})) {
            push(snap.byId?.[id]?.cwd)
          }
          for (const row of Object.values(snap.byId ?? {})) push(row?.cwd)
        }
      } catch (_error) { /* ignore */ }
      // Fallbacks seen on various shells.
      try { push(context.uiWorkspace?.current?.cwd) } catch (_error) { /* ignore */ }
      try {
        const el = document.querySelector('[data-session-cwd], [data-cwd]')
        push(el?.getAttribute('data-session-cwd') ?? el?.getAttribute('data-cwd') ?? undefined)
      } catch (_error) { /* ignore */ }
      return out
    }

    /** Candidate Host paths for one authored token, best first. */
    function buildCandidates(raw, context) {
      const cleaned = cleanPath(raw)
      const candidates = []
      const add = (p) => {
        if (typeof p === 'string' && p.length > 0 && !candidates.includes(p)) candidates.push(p)
        const win = p != null ? normalizeForWindows(p) : ''
        if (win && win !== p && !candidates.includes(win)) candidates.push(win)
      }
      if (isAbsolute(cleaned)) add(cleaned)
      for (const cwd of collectCwds(context)) add(joinPath(cwd, cleaned))
      // Last resort: as authored (Host may workspace-resolve).
      add(cleaned)
      return candidates
    }

    return {
      inject: ['remote', 'remote.session', 'sessions', 'slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.id = 'dsh-open-file-location-style'
        style.textContent = `
.ofl-reveal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  padding: 1px 5px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  vertical-align: middle;
  transition: opacity 120ms ease, background 120ms ease;
  line-height: 1;
}
.ofl-host:hover > .ofl-reveal-btn,
.ofl-reveal-btn:focus-visible,
.ofl-reveal-btn:hover {
  opacity: 0.9;
}
.ofl-reveal-btn:hover {
  background: rgba(127, 127, 127, 0.18);
}
.ofl-holder {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.ofl-menu {
  position: fixed;
  z-index: 10000;
  min-width: 168px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  background: var(--dsw-bg-elevated, #1e1e1e);
  color: var(--dsw-text, #f2f2f2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.ofl-menu-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.ofl-menu-item:hover {
  background: rgba(127, 127, 127, 0.18);
}
.ofl-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 10001;
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(20, 20, 20, 0.92);
  color: #fff;
  font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  pointer-events: none;
}
`
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove())

        const menuRoot = document.createElement('div')
        menuRoot.id = 'dsh-open-file-location-menu'
        document.body.appendChild(menuRoot)
        const unmountMenu = () => { menuRoot.replaceChildren() }
        ctx.effect(() => () => {
          unmountMenu()
          menuRoot.remove()
        })

        let toastTimer = 0
        function toast(message) {
          const el = document.createElement('div')
          el.className = 'ofl-toast'
          el.textContent = message
          document.body.appendChild(el)
          window.clearTimeout(toastTimer)
          toastTimer = window.setTimeout(() => { el.remove() }, 2800)
        }

        let busy = false
        async function revealPath(rawPath) {
          if (busy || typeof rawPath !== 'string' || rawPath.length === 0) return
          busy = true
          try {
            const candidates = buildCandidates(rawPath, ctx)
            let opened = false
            for (const path of candidates) {
              try {
                const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })
                if (result && result.ok === true) {
                  opened = true
                  break
                }
              } catch (_try) {
                // Try the next candidate.
              }
            }
            if (!opened) toast(LABEL.revealFail + '（' + cleanPath(rawPath) + '）')
          } finally {
            busy = false
          }
        }

        function isFileControl(el) {
          if (el instanceof HTMLButtonElement) return looksLikePath(el.getAttribute('title') ?? '')
          if (el instanceof HTMLAnchorElement) {
            const title = el.getAttribute('title') ?? ''
            const href = el.getAttribute('href') ?? ''
            return looksLikePath(title) || (!/^[a-z]+:/i.test(href) && looksLikePath(href))
          }
          return false
        }

        function pathOf(el) {
          if (el instanceof HTMLButtonElement) return el.getAttribute('title') ?? ''
          if (el instanceof HTMLAnchorElement) return el.getAttribute('title') || el.getAttribute('href') || ''
          return ''
        }

        function fileControlFrom(node) {
          let el = node instanceof Element ? node : node?.parentElement ?? null
          while (el != null && el !== document.documentElement) {
            if (isFileControl(el)) return el
            el = el.parentElement
          }
          return null
        }

        const marked = new WeakSet()
        function ensureHoverButton(fileBtn) {
          if (marked.has(fileBtn)) return
          marked.add(fileBtn)
          fileBtn.classList.add('ofl-host')
          const path = pathOf(fileBtn)
          const holder = document.createElement('span')
          holder.className = 'ofl-holder'
          fileBtn.parentElement?.insertBefore(holder, fileBtn)
          holder.appendChild(fileBtn)

          const chip = document.createElement('button')
          chip.type = 'button'
          chip.className = 'ofl-reveal-btn'
          chip.title = LABEL.reveal
          chip.setAttribute('aria-label', LABEL.reveal)
          chip.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M1.5 3.5h4.2l1.2 1.5H14.5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"' +
            ' fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
          chip.addEventListener('mousedown', (e) => {
            e.preventDefault()
            e.stopPropagation()
          })
          chip.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            void revealPath(path)
          })
          holder.appendChild(chip)
        }

        document.addEventListener('mouseover', (event) => {
          const t = event.target
          if (!(t instanceof Element)) return
          const fileBtn = fileControlFrom(t)
          if (fileBtn != null) ensureHoverButton(fileBtn)
        }, true)

        function showMenu(x, y, items) {
          unmountMenu()
          const box = document.createElement('div')
          box.className = 'ofl-menu'
          box.setAttribute('role', 'menu')
          box.style.left = `${Math.min(x, window.innerWidth - 180)}px`
          box.style.top = `${Math.min(y, window.innerHeight - 90)}px`
          for (const item of items) {
            const b = document.createElement('button')
            b.type = 'button'
            b.className = 'ofl-menu-item'
            b.setAttribute('role', 'menuitem')
            b.textContent = item.label
            b.addEventListener('click', () => {
              unmountMenu()
              item.run()
            })
            box.appendChild(b)
          }
          menuRoot.appendChild(box)
        }

        document.addEventListener('contextmenu', (event) => {
          const t = event.target
          if (!(t instanceof Element)) return
          const fileBtn = fileControlFrom(t)
          if (fileBtn == null) return
          const path = pathOf(fileBtn)
          if (!looksLikePath(path)) return
          event.preventDefault()
          event.stopPropagation()
          const items = [{ id: 'reveal', label: LABEL.reveal, run: () => { void revealPath(path) } }]
          if (fileBtn instanceof HTMLButtonElement) {
            items.push({ id: 'preview', label: LABEL.openPreview, run: () => { fileBtn.click() } })
          }
          showMenu(event.clientX, event.clientY, items)
        }, true)

        document.addEventListener('mousedown', (event) => {
          if (!(event.target instanceof Element)) return
          if (event.target.closest('.ofl-menu') == null) unmountMenu()
        }, true)

        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') unmountMenu()
        }, true)

        void require
      },
    }
  },
})
