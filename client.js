/**
 * open-file-location · Client half
 *
 * 给聊天正文里的文件引用（file mention / 本地文件链接）加上：
 *   1. 右键菜单「打开文件位置」
 *   2. 悬停时出现的小按钮，一点直接定位到资源管理器
 *
 * 识别方式：文件引用按钮固定带 title=完整路径（Markdown 渲染约定），
 * 不依赖会被 CSS Modules 哈希的 class 名。
 */
window.__ModuleLoader__.load({
  id: 'dsh-open-file-location',
  factory(require) {
    const LABEL = {
      reveal: '打开文件位置',
      revealFail: '无法打开文件位置，请重试',
      openPreview: '在侧边栏预览',
    }

    /** Path-shaped titles on chat file chips/links (relative, absolute POSIX, or Windows). */
    function looksLikePath(title) {
      if (typeof title !== 'string' || title.length === 0) return false
      if (title.includes('\n') || title.includes('\r')) return false
      if (/[\\/]/.test(title)) return true
      return /\.[A-Za-z0-9]{1,8}$/.test(title)
    }

    /** Resolve one title to an absolute Host path when a session cwd is known. */
    function toHostPath(path, cwd) {
      if (/^([A-Za-z]:[\\/]|\/)/.test(path)) return path
      if (typeof cwd === 'string' && cwd.length > 0) {
        const sep = cwd.includes('\\') ? '\\' : '/'
        return cwd.replace(/[\\/]+$/, '') + sep + path.replace(/^\.?[\\/]+/, '')
      }
      return path
    }

    function pickSessionCwd(context) {
      try {
        const list = context.sessions?.list?.getSnapshot?.()
        if (list == null) return undefined
        const byId = list.byId ?? {}
        const currentId = list.currentId ?? list.foregroundId ?? list.activeId
        if (currentId != null && byId[currentId]?.cwd) return byId[currentId].cwd
        for (const id of Object.keys(byId)) {
          if (byId[id]?.cwd) return byId[id].cwd
        }
      } catch (_error) {
        return undefined
      }
      return undefined
    }

    return {
      inject: ['remote', 'remote.session', 'sessions', 'slots'],
      apply(ctx) {
        // ---- styles ----
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

        // ---- floating menu host ----
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
          toastTimer = window.setTimeout(() => { el.remove() }, 2200)
        }

        // ---- reveal ----
        let busy = false
        async function revealPath(rawPath) {
          if (busy || typeof rawPath !== 'string' || rawPath.length === 0) return
          busy = true
          try {
            const path = toHostPath(rawPath, pickSessionCwd(ctx))
            const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })
            if (!result || result.ok !== true) toast(LABEL.revealFail)
          } catch (_error) {
            // Host unreachable or refused the handoff — announce, do not throw.
            toast(LABEL.revealFail)
          } finally {
            busy = false
          }
        }

        // ---- locate the file-mention control ----
        function isFileControl(el) {
          if (el instanceof HTMLButtonElement) {
            return looksLikePath(el.getAttribute('title') ?? '')
          }
          if (el instanceof HTMLAnchorElement) {
            const title = el.getAttribute('title') ?? ''
            const href = el.getAttribute('href') ?? ''
            return looksLikePath(title) || (!/^[a-z]+:/i.test(href) && looksLikePath(href))
          }
          return false
        }

        function pathOf(el) {
          if (el instanceof HTMLButtonElement) return el.getAttribute('title') ?? ''
          if (el instanceof HTMLAnchorElement) {
            return el.getAttribute('title') || el.getAttribute('href') || ''
          }
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

        // ---- hover chip ----
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

        document.addEventListener(
          'mouseover',
          (event) => {
            const t = event.target
            if (!(t instanceof Element)) return
            const fileBtn = fileControlFrom(t)
            if (fileBtn != null) ensureHoverButton(fileBtn)
          },
          true,
        )

        // ---- right-click menu ----
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

        document.addEventListener(
          'contextmenu',
          (event) => {
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
          },
          true,
        )

        document.addEventListener(
          'mousedown',
          (event) => {
            if (!(event.target instanceof Element)) return
            if (event.target.closest('.ofl-menu') == null) unmountMenu()
          },
          true,
        )

        document.addEventListener(
          'keydown',
          (event) => {
            if (event.key === 'Escape') unmountMenu()
          },
          true,
        )

        // `require` is unused for this pure-DOM client half; keep the factory signature.
        void require
      },
    }
  },
})
