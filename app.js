/* ═══════════════════════════════════════════════════════
   GYM MANAGER PRO – app.js
   Features: Setup · Login · Logout · Dashboard · Members
             Add/Edit/Delete · Pay/Unpay · Attendance
             Search · Filter · CSV Export · Reset Month
             Settings (gym name, password) · Toast · SW
═══════════════════════════════════════════════════════ */

// ── Storage Keys ──────────────────────────────────────
const KEY_CONFIG   = "gymConfig"
const KEY_MEMBERS  = "gymMembers"
const KEY_SESSION  = "gymSession"

// ── State ─────────────────────────────────────────────
let members = []
let config  = {}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  config  = JSON.parse(localStorage.getItem(KEY_CONFIG)  || "null")
  members = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]")

  if (!config) {
    show("screen-setup")
    return
  }

  const session = sessionStorage.getItem(KEY_SESSION)
  if (session === "ok") {
    launchApp()
  } else {
    show("screen-login")
    document.getElementById("login-gymname").textContent = config.gymName || "Gym Manager"
  }
}

// ═══════════════════════════════════════════════════════
//  SETUP (first run)
// ═══════════════════════════════════════════════════════
function setupGym() {
  const gymName = val("setup-gymname")
  const user    = val("setup-user")
  const pass    = val("setup-pass")
  const pass2   = val("setup-pass2")

  if (!gymName || !user || !pass) return showAuthError("setup-error", "All fields are required.")
  if (pass !== pass2)              return showAuthError("setup-error", "Passwords do not match.")
  if (pass.length < 4)             return showAuthError("setup-error", "Password must be at least 4 characters.")

  config = { gymName, user, pass }
  localStorage.setItem(KEY_CONFIG, JSON.stringify(config))
  sessionStorage.setItem(KEY_SESSION, "ok")
  launchApp()
}

// ═══════════════════════════════════════════════════════
//  LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════
function login() {
  const user = val("login-user")
  const pass = val("login-pass")

  if (user === config.user && pass === config.pass) {
    sessionStorage.setItem(KEY_SESSION, "ok")
    launchApp()
  } else {
    showAuthError("login-error", "❌ Incorrect username or password.")
    document.getElementById("login-pass").value = ""
  }
}

function logout() {
  sessionStorage.removeItem(KEY_SESSION)
  hide("screen-app")
  show("screen-login")
  document.getElementById("login-user").value = ""
  document.getElementById("login-pass").value = ""
}

function launchApp() {
  hide("screen-setup")
  hide("screen-login")
  show("screen-app")

  // Populate gym name & username in the UI
  const gn = config.gymName || "Gym Manager"
  document.getElementById("sidebar-gymname").textContent = gn
  document.getElementById("topbar-username").textContent = config.user
  document.getElementById("topbar-avatar").textContent   = (config.user[0] || "A").toUpperCase()
  document.getElementById("set-gymname").value            = gn

  showPage("dashboard")
}

// ═══════════════════════════════════════════════════════
//  PAGE NAVIGATION
// ═══════════════════════════════════════════════════════
function showPage(page) {
  const pages   = ["dashboard", "members", "settings"]
  const pageMap = { dashboard: "📊 Dashboard", members: "👥 Members", settings: "⚙️ Settings" }

  pages.forEach(p => {
    document.getElementById("page-" + p).classList.toggle("hidden", p !== page)
    document.getElementById("nav-"  + p).classList.toggle("active", p === page)
  })

  document.getElementById("topbar-title").textContent = pageMap[page] || page
  closeSidebar()

  if (page === "dashboard") renderDashboard()
  if (page === "members")   renderMembers()
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const total      = members.length
  const paid       = members.filter(m => m.paid).length
  const unpaid     = total - paid
  const revenue    = members.filter(m => m.paid).reduce((s, m) => s + (+m.fee), 0)
  const expected   = members.reduce((s, m) => s + (+m.fee), 0)
  const attendance = members.reduce((s, m) => s + (+m.attendance || 0), 0)
  const pct        = expected ? Math.round((revenue / expected) * 100) : 0

  setText("stat-total",      total)
  setText("stat-paid",       paid)
  setText("stat-unpaid",     unpaid)
  setText("stat-revenue",    revenue.toLocaleString())
  setText("stat-expected",   expected.toLocaleString())
  setText("stat-attendance", attendance)
  setText("dash-progress-label", pct + "%")
  document.getElementById("dash-progress").style.width = pct + "%"

  // Date
  document.getElementById("dash-date").textContent =
    new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" })

  // Recent members (last 5)
  const recent = [...members].reverse().slice(0, 5)
  const tbody  = document.getElementById("recent-members")
  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-data">No members yet</td></tr>`
    return
  }
  tbody.innerHTML = recent.map((m, i) => `
    <tr>
      <td>${members.length - i}</td>
      <td><strong>${esc(m.name)}</strong></td>
      <td>${esc(m.phone)}</td>
      <td>PKR ${(+m.fee).toLocaleString()}</td>
      <td>${m.paid ? '<span class="paid-badge">✅ Paid</span>' : '<span class="unpaid-badge">⚠️ Unpaid</span>'}</td>
    </tr>`).join("")
}

// ═══════════════════════════════════════════════════════
//  MEMBERS – RENDER
// ═══════════════════════════════════════════════════════
function renderMembers() {
  const search = (document.getElementById("search")?.value || "").toLowerCase()
  const filter = document.getElementById("filterStatus")?.value || "all"

  let list = members.filter((m, i) => {
    const matchSearch = esc(m.name).toLowerCase().includes(search) ||
                        (m.phone || "").includes(search)
    const matchFilter = filter === "all" ||
                        (filter === "paid"   &&  m.paid) ||
                        (filter === "unpaid" && !m.paid)
    return matchSearch && matchFilter
  })

  const tbody = document.getElementById("membersTable")
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="no-data">No members found</td></tr>`
    return
  }

  tbody.innerHTML = list.map(m => {
    const i = members.indexOf(m)
    const payBtn = m.paid
      ? `<span class="paid-badge">✅ Paid</span>
         <button class="tbtn tbtn-unpay" onclick="unpay(${i})" title="Mark Unpaid">↩ Undo</button>`
      : `<button class="tbtn tbtn-pay" onclick="pay(${i})">💳 Pay</button>`

    return `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(m.name)}</strong></td>
      <td>${esc(m.phone)}</td>
      <td><span style="font-size:0.8rem;color:var(--muted)">${esc(m.plan || "Monthly")}</span></td>
      <td>PKR ${(+m.fee).toLocaleString()}</td>
      <td>${payBtn}</td>
      <td>
        <span style="font-weight:700;margin-right:6px">${m.attendance || 0}</span>
        <button class="tbtn tbtn-attend" onclick="attend(${i})">+1</button>
      </td>
      <td style="font-size:0.82rem;color:var(--muted)">${esc(m.joinDate || "-")}</td>
      <td style="max-width:110px;font-size:0.78rem;color:var(--muted)">${esc(m.notes || "-")}</td>
      <td style="white-space:nowrap">
        <button class="tbtn tbtn-edit" onclick="openEditModal(${i})">✏️</button>
        <button class="tbtn tbtn-delete" onclick="removeMember(${i})">🗑️</button>
      </td>
    </tr>`
  }).join("")
}

// ═══════════════════════════════════════════════════════
//  MEMBERS – CRUD
// ═══════════════════════════════════════════════════════
function openAddModal() {
  document.getElementById("modal-title").textContent = "➕ Add New Member"
  document.getElementById("m-edit-index").value = "-1"
  document.getElementById("m-name").value  = ""
  document.getElementById("m-phone").value = ""
  document.getElementById("m-fee").value   = ""
  document.getElementById("m-plan").value  = "Monthly"
  document.getElementById("m-date").value  = todayISO()
  document.getElementById("m-notes").value = ""
  document.getElementById("modal-overlay").classList.remove("hidden")
}

function openEditModal(index) {
  const m = members[index]
  document.getElementById("modal-title").textContent = "✏️ Edit Member"
  document.getElementById("m-edit-index").value = index
  document.getElementById("m-name").value  = m.name
  document.getElementById("m-phone").value = m.phone
  document.getElementById("m-fee").value   = m.fee
  document.getElementById("m-plan").value  = m.plan || "Monthly"
  document.getElementById("m-date").value  = m.joinDate || todayISO()
  document.getElementById("m-notes").value = m.notes || ""
  document.getElementById("modal-overlay").classList.remove("hidden")
}

function closeAddModal() {
  document.getElementById("modal-overlay").classList.add("hidden")
}

function closeModal(e) {
  if (e.target === document.getElementById("modal-overlay")) closeAddModal()
}

function saveMember() {
  const name  = document.getElementById("m-name").value.trim()
  const phone = document.getElementById("m-phone").value.trim()
  const fee   = document.getElementById("m-fee").value.trim()
  const plan  = document.getElementById("m-plan").value
  const date  = document.getElementById("m-date").value || todayISO()
  const notes = document.getElementById("m-notes").value.trim()
  const idx   = parseInt(document.getElementById("m-edit-index").value)

  if (!name || !phone || !fee) { toast("⚠️ Name, Phone & Fee are required!", "var(--red)"); return }

  const data = { name, phone, fee: +fee, plan, joinDate: date, notes,
                 paid: false, attendance: 0 }

  if (idx === -1) {
    members.push(data)
    toast("✅ Member added!")
  } else {
    // preserve paid & attendance on edit
    data.paid       = members[idx].paid
    data.attendance = members[idx].attendance
    members[idx]    = data
    toast("✏️ Member updated!")
  }

  saveMembers()
  closeAddModal()
  renderMembers()
}

function pay(index) {
  members[index].paid = true
  saveMembers()
  renderMembers()
  toast(`💰 ${members[index].name} marked as Paid`)
}

function unpay(index) {
  members[index].paid = false
  saveMembers()
  renderMembers()
  toast(`↩ ${members[index].name} marked Unpaid`, "var(--yellow)")
}

function attend(index) {
  members[index].attendance = (members[index].attendance || 0) + 1
  saveMembers()
  renderMembers()
  toast(`📌 Attendance → ${members[index].name}: ${members[index].attendance}`, "var(--blue)")
}

function removeMember(index) {
  if (!confirm(`Delete "${members[index].name}"? This cannot be undone.`)) return
  const name = members[index].name
  members.splice(index, 1)
  saveMembers()
  renderMembers()
  toast(`🗑️ ${name} deleted`, "var(--red)")
}

function resetMonth() {
  if (!confirm("Reset all payment statuses and attendance for a new month?")) return
  members.forEach(m => { m.paid = false; m.attendance = 0 })
  saveMembers()
  renderMembers()
  toast("🔄 Month reset done!")
}

// ═══════════════════════════════════════════════════════
//  CSV EXPORT
// ═══════════════════════════════════════════════════════
function exportCSV() {
  if (!members.length) { toast("No members to export", "var(--red)"); return }
  const header = ["#","Name","Phone","Plan","Fee (PKR)","Paid","Attendance","Join Date","Notes"]
  const rows = members.map((m, i) =>
    [i+1, m.name, m.phone, m.plan||"Monthly", m.fee, m.paid?"Yes":"No",
     m.attendance||0, m.joinDate||"", m.notes||""].join(",")
  )
  const csv  = [header.join(","), ...rows].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const a    = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `gym-members-${todayISO()}.csv`
  })
  a.click()
  toast("📥 CSV exported!")
}

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
function saveGymName() {
  const gn = document.getElementById("set-gymname").value.trim()
  if (!gn) { toast("Enter a gym name", "var(--red)"); return }
  config.gymName = gn
  saveConfig()
  document.getElementById("sidebar-gymname").textContent = gn
  toast("🏢 Gym name saved!")
}

function changePassword() {
  const old  = document.getElementById("set-old-pass").value
  const np   = document.getElementById("set-new-pass").value
  const np2  = document.getElementById("set-new-pass2").value
  const msg  = document.getElementById("pass-msg")

  if (old !== config.pass) {
    showEl("pass-msg", "❌ Current password is wrong.", true); return
  }
  if (!np || np.length < 4) {
    showEl("pass-msg", "New password must be at least 4 characters.", true); return
  }
  if (np !== np2) {
    showEl("pass-msg", "New passwords do not match.", true); return
  }

  config.pass = np
  saveConfig()
  document.getElementById("set-old-pass").value = ""
  document.getElementById("set-new-pass").value  = ""
  document.getElementById("set-new-pass2").value = ""
  msg.classList.add("hidden")
  toast("🔐 Password updated!")
}

function clearAllData() {
  if (!confirm("⚠️ This will delete ALL members and reset the app. Are you sure?")) return
  if (!confirm("Really? This CANNOT be undone!")) return
  localStorage.removeItem(KEY_CONFIG)
  localStorage.removeItem(KEY_MEMBERS)
  sessionStorage.removeItem(KEY_SESSION)
  location.reload()
}

// ═══════════════════════════════════════════════════════
//  SIDEBAR TOGGLE (mobile)
// ═══════════════════════════════════════════════════════
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open")
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open")
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
let toastTimer
function toast(msg, bg = "var(--green)") {
  const el = document.getElementById("toast")
  el.textContent    = msg
  el.style.background = bg
  el.style.color    = bg === "var(--green)" ? "#071810" : "white"
  el.classList.add("show")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800)
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function save()        { saveMembers(); saveConfig() }
function saveMembers() { localStorage.setItem(KEY_MEMBERS, JSON.stringify(members)) }
function saveConfig()  { localStorage.setItem(KEY_CONFIG,  JSON.stringify(config))  }

function val(id)       { return document.getElementById(id)?.value?.trim() || "" }
function setText(id, v){ const el=document.getElementById(id); if(el) el.textContent=v }
function show(id)      { document.getElementById(id)?.classList.remove("hidden") }
function hide(id)      { document.getElementById(id)?.classList.add("hidden") }
function esc(str)      { return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") }
function todayISO()    { return new Date().toISOString().slice(0, 10) }

function showAuthError(id, msg) {
  const el = document.getElementById(id)
  if (!el) return
  el.textContent = msg
  el.classList.remove("hidden")
}

function showEl(id, msg, isError = false) {
  const el = document.getElementById(id)
  if (!el) return
  el.textContent = msg
  el.style.background = isError ? "#450a0a" : "#052e16"
  el.style.color      = isError ? "#fca5a5" : "#86efac"
  el.style.borderColor= isError ? "#7f1d1d" : "#14532d"
  el.classList.remove("hidden")
}

// ═══════════════════════════════════════════════════════
//  SERVICE WORKER
// ═══════════════════════════════════════════════════════
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js")
    .then(() => console.log("✅ Service Worker registered"))
    .catch(e  => console.warn("SW:", e))
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
initApp()
