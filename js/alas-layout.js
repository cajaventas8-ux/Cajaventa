/**
 * ALAS ACUSE - Template Engine
 *
 * Centraliza navbar, sidebar y notificaciones para las pantallas reales.
 */
document.addEventListener("DOMContentLoaded", function() {
  ensureInterFont();

  const path = window.location.pathname;
  const page = path.split("/").pop() || "dashboard-Cajaventa.html";
  const estado = new URLSearchParams(window.location.search).get("estado") || "";

  const menuItems = [
    { href: "/views/dashboard-Cajaventa.html", icon: "fa-chart-pie", label: "Dashboard resumen", group: "Principal" },
    { href: "/views/pedidos.html", icon: "fa-file-signature", label: "Pedidos", group: "Operativa", badgeTarget: "total", badgeVariant: "count" },
    { href: "/views/pedidos.html?estado=pendiente", icon: "fa-clock", label: "Pendientes", group: "Operativa", badgeTarget: "pendientes", badgeVariant: "badge", isActive: page === "pedidos.html" && estado === "pendiente" },
    { href: "/views/dashboard-Cajaventa.html", icon: "fa-history", label: "Historial y calendario", group: "Operativa" }
  ];

  const groupedItems = new Map();
  menuItems.forEach(function(item) {
    const key = item.group;
    if (!groupedItems.has(key)) groupedItems.set(key, []);
    groupedItems.get(key).push(item);
  });

  const menuHTML = Array.from(groupedItems.entries()).map(function([groupName, items]) {
    const itemsHTML = items.map(function(item) {
      const itemUrl = new URL(item.href, window.location.origin);
      const itemPage = itemUrl.pathname.split("/").pop() || "";
      const itemEstado = itemUrl.searchParams.get("estado") || "";
      const activeClass = item.isActive || (page === itemPage && itemEstado === estado) ? "sidebar__item--active" : "";
      const disabledClass = item.disabled ? " sidebar__item--disabled" : "";
      const badge = item.badgeTarget
        ? `<span class="${item.badgeVariant === "badge" ? "sidebar__badge" : "sidebar__count"}" data-sidebar-badge="${item.badgeTarget}" style="display:none;"></span>`
        : "";
      return `<li>
        <a href="${item.href}" class="sidebar__item ${activeClass}${disabledClass}" ${item.disabled ? 'data-disabled="true" aria-disabled="true"' : ''}>
          <span class="sidebar__icon"><i class="fas ${item.icon}"></i></span>
          <span class="sidebar__label">${item.label}</span>
          ${badge}
        </a>
      </li>`;
    }).join("");

    return `
      <div class="sidebar__group">
        <span class="sidebar__group-label">${groupName}</span>
        <ul class="sidebar__menu">${itemsHTML}</ul>
      </div>
    `;
  }).join("");

  const layoutHTML = `
    <div class="app-shell">
      <aside class="sidebar" role="complementary">
        <div class="sidebar__header">
          <a href="/views/dashboard-Cajaventa.html" class="sidebar__brand" aria-label="ALAS">
            <img src="/assets/img/alas_logo.png" alt="ALAS Logo" class="sidebar__brand-logo">
          </a>
        </div>

        <nav class="sidebar__nav" aria-label="Navegacion principal">
          <div style="padding: 6px 8px 8px; border-bottom: 1px solid rgba(226,232,240,0.55); margin-bottom: 4px;">
            <a href="https://launcher-tawny.vercel.app"
               class="sidebar__item"
               title="Volver al Launcher ALAS"
               style="color: #0B5F8D; font-weight: 500;"
               onclick="alasGoToLauncher(); return false;"
            >
              <span class="sidebar__icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                  <rect width="7" height="7" x="3" y="3" rx="1.5"/>
                  <rect width="7" height="7" x="14" y="3" rx="1.5"/>
                  <rect width="7" height="7" x="14" y="14" rx="1.5"/>
                  <rect width="7" height="7" x="3" y="14" rx="1.5"/>
                </svg>
              </span>
              <span class="sidebar__label">Menú principal</span>
            </a>
          </div>
          ${menuHTML}
        </nav>

        <div class="sidebar__footer">
          <button type="button" class="sidebar__user-card" id="sidebarUserCard" title="Cambiar operador actual">
            <span class="sidebar__user-avatar" id="sidebarUserAvatar">OP</span>
            <span class="sidebar__user-meta">
              <span class="sidebar__user-name" id="sidebarUserName">Configurar operador</span>
              <span class="sidebar__user-status" id="sidebarUserStatus">Click para definir operador</span>
            </span>
            <span class="sidebar__user-logout"><i class="fas fa-sign-out-alt"></i></span>
          </button>
        </div>
      </aside>

      <div class="main-content" role="main">
        <div class="app-topbar">
          <div class="app-topbar__left">
            <button class="app-topbar__toggle" id="sidebarToggle" type="button" aria-label="Mostrar u ocultar barra lateral">
              <i class="fas fa-bars"></i>
            </button>
            <div class="app-topbar__actions" id="layoutTopbarActions"></div>
          </div>
        </div>

        <div class="main-content__stage" id="dynamic-main-content"></div>
      </div>
    </div>
  `;

  const rootElement = document.getElementById("layout-root");
  if (rootElement) {
    const originalMain = document.querySelector(".main-content__container");
    rootElement.innerHTML = layoutHTML;

    // ALASMotionBridge — oculta el root; enterProject se llama desde acuses-api.js
    // cuando el catalog-loader termina, igual que Calendario llama enterProject al fin del bootstrap
    if (window.ALASTransition) {
      ALASTransition.init({ root: '#layout-root' });
    }

    if (originalMain) {
      originalMain.classList.add("main-content__container--app-layout");
      document.getElementById("dynamic-main-content").appendChild(originalMain);
      originalMain.style.display = "";
      setupPageTopbar(page, originalMain);
    }
  }

  ensureSessionManager();

  // Si hay sesión SSO activa, sincroniza el sidebar con el usuario del Launcher
  if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
    const ssoUser = window.AlasAuthClient.getCurrentUser();
    if (ssoUser) window.AlasSession.setCurrentUser(ssoUser);
  }

  const sbToggle = document.getElementById("sidebarToggle");
  if (sbToggle) {
    sbToggle.addEventListener("click", function() {
      const sidebar = document.querySelector(".sidebar");
      if (sidebar) sidebar.classList.toggle("sidebar--collapsed");
    });
  }

  document.querySelectorAll(".sidebar__item[data-disabled='true']").forEach(function(item) {
    item.addEventListener("click", function(event) {
      event.preventDefault();
    });
  });

  const userCard = document.getElementById("sidebarUserCard");
  if (userCard) {
    userCard.addEventListener("click", function() {
      // Si hay sesión SSO activa, mostrar info en lugar de prompt
      if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
        const u = window.AlasAuthClient.user;
        if (window.AlasToast) {
          window.AlasToast.show(
            'Sesión: ' + (u.name || u.email) + ' (' + (u.role || 'operador') + ')',
            'info', 3000
          );
        }
        return;
      }
      window.AlasSession.promptForCurrentUser({ force: true });
    });
  }

  window.AlasSession.syncUserCard();
  hydrateSidebarBadges();
});

function setupPageTopbar(page, originalMain) {
  const topbarActions = document.getElementById("layoutTopbarActions");
  if (!topbarActions || !originalMain) return;

  if (page === "pedidos.html") {
    const heading = originalMain.querySelector(".page-heading");
    const pageActions = heading?.querySelector(".page-actions");
    if (pageActions) {
      topbarActions.appendChild(pageActions);
      pageActions.classList.add("app-topbar__actions-inner");
      const nuevoBtn = pageActions.querySelector("#btnNuevoAcuse");
      const exportBtn = pageActions.querySelector("#btnExportarAcuses");
      if (nuevoBtn) {
        pageActions.prepend(nuevoBtn);
      }
      if (exportBtn) {
        exportBtn.innerHTML = '<i class="fas fa-file-excel"></i> Exportar Excel';
      }
    }
    if (heading) {
      heading.remove();
    }
  }
}

async function hydrateSidebarBadges() {
  try {
    // Intentar desde Supabase primero
    if (window.Supabase) {
      const resumen = await window.Supabase.Pedidos.getResumen();
      const badgeMap = {
        total: Number(resumen.total || 0),
        pendientes: Number(resumen.pendientes || 0),
        repartidores: 0
      };

      // Obtener conteo de repartidores
      try {
        const reps = await window.Supabase.Repartidores.getAll();
        badgeMap.repartidores = reps.length;
      } catch (_) {}

      document.querySelectorAll("[data-sidebar-badge]").forEach(function(node) {
        const key = node.getAttribute("data-sidebar-badge");
        const value = badgeMap[key];
        if (!Number.isFinite(value)) return;
        node.textContent = String(value);
        node.style.display = "";
      });
      return;
    }

    // Fallback a API
    if (!window.AcuseAPI) return;
    const data = await window.AcuseAPI.get('/api/dashboard/resumen');
    const resumen = data?.resumen || {};
    const badgeMap = {
      total: Number(resumen.total || 0),
      pendientes: Number(resumen.pendientes || 0),
      repartidores: Number(resumen.repartidores || 0)
    };

    document.querySelectorAll("[data-sidebar-badge]").forEach(function(node) {
      const key = node.getAttribute("data-sidebar-badge");
      const value = badgeMap[key];
      if (!Number.isFinite(value)) return;
      node.textContent = String(value);
      node.style.display = "";
    });
  } catch (_) { /* fallo silencioso */ }
}

function ensureInterFont() {
  if (document.querySelector('link[data-font="inter"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
  link.setAttribute("data-font", "inter");
  document.head.appendChild(link);
}

function ensureSessionManager() {
  if (window.AlasSession) {
    window.AlasSession.syncUserCard?.();
    return;
  }

  const storageKey = "acuse.currentUser";
  const defaultUser = "Operador General";

  function normalizeUserName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function loadStoredUser() {
    try {
      return normalizeUserName(window.localStorage.getItem(storageKey));
    } catch (error) {
      return "";
    }
  }

  function saveStoredUser(value) {
    try {
      if (value) window.localStorage.setItem(storageKey, value);
      else window.localStorage.removeItem(storageKey);
    } catch (error) {
      // Ignore storage errors and keep the in-memory result.
    }
  }

  function currentConfiguredUser() {
    return loadStoredUser();
  }

  function initialsFor(value) {
    const parts = normalizeUserName(value).split(" ").filter(Boolean).slice(0, 2);
    if (!parts.length) return "OP";
    return parts.map(function(part) { return part.charAt(0).toUpperCase(); }).join("");
  }

  function syncUserCard() {
    const configuredUser = currentConfiguredUser();
    const displayName = configuredUser || "Configurar operador";
    const statusText = configuredUser ? "Se usa en auditoria" : "Click para definir operador";
    const nameNode = document.getElementById("sidebarUserName");
    const statusNode = document.getElementById("sidebarUserStatus");
    const avatarNode = document.getElementById("sidebarUserAvatar");
    const cardNode = document.getElementById("sidebarUserCard");

    if (nameNode) nameNode.textContent = displayName;
    if (statusNode) statusNode.textContent = statusText;
    if (avatarNode) avatarNode.textContent = initialsFor(configuredUser || defaultUser);
    if (cardNode) {
      const tooltipName = configuredUser || defaultUser;
      cardNode.setAttribute("title", `Operador actual: ${tooltipName}`);
      cardNode.setAttribute("aria-label", `Operador actual: ${tooltipName}`);
    }
  }

  function setCurrentUser(value) {
    const normalized = normalizeUserName(value);
    saveStoredUser(normalized);
    syncUserCard();
    return normalized;
  }

  function getCurrentUser() {
    // Prioridad: usuario del Launcher (SSO) → localStorage → default
    if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
      return window.AlasAuthClient.getCurrentUser() || defaultUser;
    }
    return currentConfiguredUser() || defaultUser;
  }

  function promptForCurrentUser(options = {}) {
    // Si hay sesión SSO activa, no usar prompt() — el usuario viene del Launcher
    if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
      const ssoUser = window.AlasAuthClient.getCurrentUser();
      if (window.AlasToast) {
        const u = window.AlasAuthClient.user;
        window.AlasToast.show(
          'Sesión activa: ' + ssoUser + ' (' + (u.role || 'operador') + ')',
          'info', 3000
        );
      }
      return ssoUser;
    }

    // Flujo original para cuando no hay SSO
    const current = currentConfiguredUser() || "";
    const response = window.prompt(
      "Ingresa el nombre del operador actual para registrar acciones en auditoria.",
      current
    );

    if (response === null) return null;

    const normalized = normalizeUserName(response);
    if (!normalized) {
      if (options.force && window.AlasToast) {
        window.AlasToast.show("Debes indicar un operador para continuar.", "warning");
      }
      return null;
    }

    setCurrentUser(normalized);
    if (window.AlasToast) {
      window.AlasToast.show(`Operador actual: ${normalized}`, "success", 2500);
    }
    return normalized;
  }

  function requireCurrentUser() {
    const configured = currentConfiguredUser();
    if (configured) return configured;
    return defaultUser;
  }

  window.AlasSession = {
    defaultUser,
    getCurrentUser,
    promptForCurrentUser,
    requireCurrentUser,
    setCurrentUser,
    syncUserCard
  };
}

window.AlasToast = {
  container: null,
  removeDelay: 260,
  init: function() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.classList.add("toast-container");
      document.body.appendChild(this.container);
    }
  },
  show: function(message, type = "success", duration = 2200) {
    this.init();
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;

    const iconWrap = document.createElement("span");
    iconWrap.className = "toast__icon-wrap";
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.appendChild(this.createIcon(type));

    const textNode = document.createElement("span");
    textNode.className = "toast__text";
    textNode.textContent = String(message || "");

    toast.appendChild(iconWrap);
    toast.appendChild(textNode);
    this.container.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add("toast--show");
    });

    window.setTimeout(() => {
      toast.classList.remove("toast--show");
      toast.classList.add("toast--hide");
      window.setTimeout(() => { toast.remove(); }, this.removeDelay);
    }, duration);
  },
  createIcon: function(type) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.classList.add("toast__icon-svg");

    const iconPaths = {
      success: ["M5 12.5l4 4L19 7"],
      complete: ["M5 12.5l4 4L19 7"],
      annul: ["M9 4.75h6", "M7.75 7.5h8.5", "M9 10.25v6.5", "M12 10.25v6.5", "M15 10.25v6.5", "M8.75 19.25h6.5a1.5 1.5 0 001.49-1.325l.95-8.925h-11.88l.95 8.925a1.5 1.5 0 001.49 1.325z"],
      error: ["M7 7l10 10", "M17 7L7 17"],
      warning: ["M12 7v6", "M12 17h.01"],
      info: ["M12 11v6", "M12 7h.01"]
    };

    (iconPaths[type] || iconPaths.info).forEach((d) => {
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });

    return svg;
  }
};
