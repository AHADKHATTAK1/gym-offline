/* ═══════════════════════════════════════════════════════
   GYM MANAGER PRO V12 – app.js
   Features: Offline PWA | QR | Trials | Payments | Diet
             Self-Registration | Multi-User | IndexedDB
═══════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════
//  IndexedDB SETUP  (replaces localStorage for members)
// ═══════════════════════════════════════════════════════
const DB_NAME    = "GymManagerDB"
const DB_VERSION = 1
let db = null

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const d = e.target.result
      // Members store with auto-incrementing primary key + searchable indexes
      if (!d.objectStoreNames.contains("members")) {
        const store = d.createObjectStore("members", { keyPath: "id" })
        store.createIndex("name",   "name",   { unique: false })
        store.createIndex("phone",  "phone",  { unique: false })
        store.createIndex("expiry", "expiry", { unique: false })
      }
      // Expenses store
      if (!d.objectStoreNames.contains("expenses")) {
        d.createObjectStore("expenses", { keyPath: "id" })
      }
    }
    req.onsuccess = (e) => { db = e.target.result; resolve(db) }
    req.onerror   = (e) => reject(e.target.error)
  })
}

// IDB Helpers — all async
function idbGetAll(storeName) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly")
    tx.objectStore(storeName).getAll().onsuccess = (e) => resolve(e.target.result)
  })
}
function idbPut(storeName, obj) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).put(obj).onsuccess = () => resolve()
  })
}
function idbDelete(storeName, id) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).delete(id).onsuccess = () => resolve()
  })
}
function idbClear(storeName) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).clear().onsuccess = () => resolve()
  })
}

// ═══════════════════════════════════════════════════════
//  CONFIG (still in localStorage — tiny, fast)
// ═══════════════════════════════════════════════════════
const KEY_CONFIG  = "gymConfigV5"
const KEY_SESSION = "gymSessionV5"
const LIFETIME_EXPIRY = "2099-12-31"

let members  = []   // In-memory cache (loaded from IndexedDB on launch)
let expenses = []   // Same
let config   = {}
let currentUser = null   // Active logged-in user object
let revChart, attChart
let html5QrcodeScanner = null
let currentCheckoutId  = null

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
async function initApp() {
  await openDB()
  config = JSON.parse(localStorage.getItem(KEY_CONFIG) || "null")

  // Migrate from old V3/V4 data if needed
  if (!config) {
    const oldConfig = JSON.parse(localStorage.getItem("gymConfigV3") || "null")
    if (oldConfig) {
      config = oldConfig
      // Copy users array if missing
      if (!config.users) config.users = [{ user: config.user, pass: config.pass, role: "admin" }]
      saveConfig()
      // Migrate old members from localStorage to IndexedDB
      const oldMembers = JSON.parse(localStorage.getItem("gymMembersV4") || localStorage.getItem("gymMembersV3") || "[]")
      for (const m of oldMembers) await idbPut("members", m)
      const oldExp = JSON.parse(localStorage.getItem("gymExpensesV4") || "[]")
      for (const e of oldExp) await idbPut("expenses", e)
    }
  }

  members  = await idbGetAll("members")
  expenses = await idbGetAll("expenses")

  if (!config) return show("screen-setup")

  // V11: Software Subscription Guard
  if (checkAppSubscription()) return

  // Ensure users array exists
  if (!config.users) { config.users = [{ user: config.user, pass: config.pass, role: "admin" }]; saveConfig() }

  const s = sessionStorage.getItem(KEY_SESSION)
  if (s) {
    currentUser = JSON.parse(s)
    launchApp()
  } else {
    show("screen-login")
    setText("login-gymname", config.gymName || "Gym Manager")
  }
}

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════
function setupGym() {
  const gymName = val("setup-gymname"), user = val("setup-user"), pass = val("setup-pass")
  if (!gymName || !user || !pass) return showErr("setup-error", "All fields required.")
  if (pass !== val("setup-pass2"))  return showErr("setup-error", "Passwords do not match.")
  
  // V11: Set initial 3-day trial for the software itself
  const trialExpiry = new Date()
  trialExpiry.setDate(trialExpiry.getDate() + 3)
  
  config = { 
    gymName, user, pass, 
    bankDetails: "", stripeLink: "", 
    users: [{ user, pass, role: "admin" }],
    appSubscriptionExpiry: trialExpiry.toISOString().split("T")[0]
  }
  
  saveConfig(); currentUser = { user, role: "admin" }
  sessionStorage.setItem(KEY_SESSION, JSON.stringify(currentUser)); launchApp()
}

function login() {
  const u = val("login-user"), p = val("login-pass")
  if (!u || !p) return showErr("login-error", "❌ Please enter details.")

  // 1. Check Admin/Staff
  const staff = config.users?.find(x => x.user === u && x.pass === p)
  if (staff) {
    currentUser = { user: staff.user, role: staff.role, type: "admin" }
    sessionStorage.setItem(KEY_SESSION, JSON.stringify(currentUser)); launchApp()
    return
  }

  // 2. Check Member
  const mem = members.find(x => x.phone === u || x.id === u)
  if (mem && (p === mem.id || p === mem.phone)) {
    currentUser = { user: mem.name, id: mem.id, type: "member" }
    sessionStorage.setItem(KEY_SESSION, JSON.stringify(currentUser)); launchMemberPortal(mem)
    return
  }

  showErr("login-error", "❌ Incorrect credentials.")
}

function logout() {
  sessionStorage.removeItem(KEY_SESSION); currentUser = null
  hide("screen-app"); hide("screen-member"); show("screen-login")
  document.getElementById("login-pass").value = ""
  setText("login-gymname", config.gymName || "Gym Manager")
}

function launchApp() {
  if (checkAppSubscription()) return
  if (currentUser?.type === "member") return launchMemberPortal(members.find(x=>x.id===currentUser.id))
  
  hide("screen-setup"); hide("screen-login"); hide("screen-register"); hide("screen-member"); show("screen-app")
  const gn = config.gymName || "Gym Manager"
  setText("sidebar-gymname", gn); setText("topbar-username", currentUser.user)
  setText("topbar-avatar", currentUser.user[0].toUpperCase())
  document.getElementById("set-gymname").value = gn
  document.getElementById("set-bank").value = config.bankDetails || ""
  document.getElementById("set-stripe").value = config.stripeLink || ""
  document.getElementById("exp-date").value = todayISO()
  renderStaffList()
  renderSubscriptionStatus()
  showPage("dashboard")
}

function launchMemberPortal(m) {
  hide("screen-setup"); hide("screen-login"); hide("screen-register"); hide("screen-app"); show("screen-member")
  setText("mem-portal-name", m.name)
  setText("mem-portal-id", m.id)
  
  currentCheckoutId = m.id // so payments link knows who to charge
  
  const todayStr = todayISO()
  const stBox = document.getElementById("mem-portal-status-box")
  const payBtn = document.getElementById("mem-portal-pay-btn")
  
  if (m.status === "pending") {
    stBox.style.cssText = "background:#b45309;color:#fff"
    stBox.innerHTML = "⏳ Pending Gateway Appr."
    payBtn.classList.add("hidden")
  } else if (m.expiry < todayStr) {
    stBox.style.cssText = "background:#7f1d1d;color:#fca5a5"
    stBox.innerHTML = `🔴 Expired (${m.expiry})`
    payBtn.classList.remove("hidden")
  } else if (m.plan === "trial") {
    stBox.style.cssText = "background:#854d0e;color:#fef08a"
    stBox.innerHTML = `🟡 Trial Active (Ends ${m.expiry})`
    payBtn.classList.remove("hidden")
  } else {
    stBox.style.cssText = "background:#064e3b;color:#34d399"
    stBox.innerHTML = `🟢 Active (Expires ${m.expiry})`
    payBtn.classList.add("hidden") // optionally let them renew early, keeping hidden for now
  }

  if (typeof QRious !== "undefined") {
    new QRious({ element: document.getElementById("mem-portal-qr"), value: m.id, size: 180 })
  }
}

function downloadMemberCard() {
  const mId = document.getElementById("mem-portal-id").textContent;
  const m = members.find(x => x.id === mId);
  if (!m) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [85, 55] }); // Credit card size

  // Background
  doc.setFillColor(30, 41, 59); // var(--surface)
  doc.rect(0, 0, 55, 85, "F");

  // Gym Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(config.gymName || "Gym Manager", 27.5, 10, { align: "center" });

  // Member Name
  doc.setFontSize(10);
  doc.text(m.name, 27.5, 20, { align: "center" });

  // Member ID
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // var(--muted)
  doc.text(m.id, 27.5, 25, { align: "center" });

  // QR Code
  const qrCanvas = document.getElementById("mem-portal-qr");
  const qrDataMap = qrCanvas.toDataURL("image/png");
  doc.addImage(qrDataMap, "PNG", 10, 32, 35, 35);

  // Status
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text("Valid Membership Card", 27.5, 75, { align: "center" });

  doc.save(`${m.name}_Card.pdf`);
}

// ═══════════════════════════════════════════════════════
//  SELF-REGISTRATION (Member fills in their own form)
// ═══════════════════════════════════════════════════════
function openRegisterScreen() {
  hide("screen-login"); hide("screen-app"); hide("screen-checkout")
  // Reset fields
  ;["reg-name", "reg-phone", "reg-fee"].forEach(id => document.getElementById(id).value = "")
  document.getElementById("reg-plan").value = "trial"
  hide("reg-success")
  document.getElementById("reg-error").classList.add("hidden")
  document.querySelectorAll(".auth-form input, .auth-form select").forEach(el => el.style.display = "")
  show("screen-register")
  setText("reg-gymname", config.gymName || "the Gym")
}

function openRegisterFromAdmin() {
  closeSidebar()
  openRegisterScreen()
}

function closeRegisterScreen() {
  hide("screen-register")
  if (currentUser) show("screen-app")
  else show("screen-login")
}

async function selfRegister() {
  const name  = val("reg-name")
  const phone = val("reg-phone")
  const fee   = val("reg-fee")
  const plan  = val("reg-plan")

  if (!name || !phone || !fee) return showErr("reg-error", "⚠️ Name, Phone, and Fee are required.")
  document.getElementById("reg-error").classList.add("hidden")

  const newId = "GYM-" + Math.floor(Math.random() * 90000 + 10000)
  const start = new Date()
  if (plan === "trial") start.setDate(start.getDate() + 7)
  else start.setMonth(start.getMonth() + parseInt(plan))
  const expiry = start.toISOString().split("T")[0]

  const newMember = { id: newId, name, phone, fee, plan, date: todayISO(), expiry, visits: 0, status: "active", notes: "" }
  await idbPut("members", newMember)
  members.push(newMember)

  // Show success + QR
  setText("reg-member-id", newId)
  setText("reg-success-msg", `Welcome, ${name}! 🎉`)

  // Hide form fields
  document.querySelectorAll("#screen-register .auth-form input, #screen-register .auth-form select, #screen-register .auth-form .btn-primary").forEach(el => el.style.display = "none")

  show("reg-success")

  if (typeof QRious !== "undefined") {
    new QRious({ element: document.getElementById("reg-qr"), value: newId, size: 150 })
  }

  // Refresh admin views if they were loaded
  if (currentUser) { renderMembers(); renderDashboard() }
}

// ═══════════════════════════════════════════════════════
//  MULTI-USER STAFF MANAGEMENT
// ═══════════════════════════════════════════════════════
function renderStaffList() {
  const el = document.getElementById("staff-list"); if (!el) return
  el.innerHTML = (config.users || []).map(u => `
    <tr>
      <td><strong>${esc(u.user)}</strong></td>
      <td><span class="badge ${u.role==='admin'?'active':'trial'}">${u.role}</span></td>
      <td>${u.user !== config.user ? `<button class="tbtn tbtn-delete" onclick="removeStaff('${u.user}')">🗑️</button>` : `<span style="color:var(--muted);font-size:0.8rem">Owner</span>`}</td>
    </tr>`).join("")
}
function addStaff() {
  const u=val("new-staff-user"), p=val("new-staff-pass"), r=val("new-staff-role")
  if (!u||!p) return toast("⚠️ Username and password required","var(--red)")
  if (config.users.find(x=>x.user===u)) return toast("⚠️ Username already exists","var(--red)")
  config.users.push({user:u,pass:p,role:r}); saveConfig(); renderStaffList()
  document.getElementById("new-staff-user").value=""; document.getElementById("new-staff-pass").value=""
  toast(`✅ Staff '${u}' added as ${r}!`)
}
function removeStaff(username) {
  if (!confirm(`Remove ${username}?`)) return
  config.users=config.users.filter(x=>x.user!==username); saveConfig(); renderStaffList()
  toast(`🗑️ ${username} removed.`,"var(--red)")
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
function showPage(page) {
  if (checkAppSubscription()) return
  document.querySelectorAll(".page").forEach(el => el.classList.add("hidden"))
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"))
  show("page-" + page); document.getElementById("nav-" + page)?.classList.add("active")
  setText("topbar-title", document.getElementById("nav-" + page)?.textContent?.trim() || page.charAt(0).toUpperCase() + page.slice(1))
  closeSidebar()
  if (page === "dashboard")  renderDashboard()
  if (page === "members")    renderMembers()
  if (page === "finances")   renderFinances()
  if (page === "settings")   renderSubscriptionStatus()
  if (page === "attendance") {
    document.getElementById("att-date").value = todayISO()
    renderAttendance()
  }
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const todayStr = todayISO()
  let act = 0, expCount = 0, rev = 0, pending = []

  members.forEach(m => {
    if (m.status === "pending") { pending.push(m); return }
    if (m.expiry >= todayStr && m.plan !== "trial") { act++; rev += (+m.fee || 0) }
    else if (m.expiry < todayStr) expCount++
  })

  const thisMonth = todayStr.substring(0, 7)
  const expTotal  = expenses.filter(e => e.date.startsWith(thisMonth)).reduce((s, e) => s + (+e.amount), 0)

  setText("stat-total",   members.length)
  setText("stat-active",  act)
  setText("stat-expired", expCount)
  const profit = rev - expTotal
  const pEl = document.getElementById("stat-profit")
  pEl.textContent = "PKR " + profit.toLocaleString()
  pEl.style.color = profit >= 0 ? "var(--green)" : "var(--red)"
  setText("dash-date", new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" }))

  // ── Expiring Soon (next 7 days) ──
  const in7 = new Date(); in7.setDate(in7.getDate() + 7); const in7Str = in7.toISOString().split("T")[0]
  const expiring = members.filter(m => m.expiry >= todayStr && m.expiry <= in7Str && m.plan !== "trial" && m.status !== "pending")
  const exBox = document.getElementById("expiring-box"), exTb = document.getElementById("expiringTable")
  if (expiring.length) {
    exBox.style.display = "block"
    exTb.innerHTML = expiring.map(m => {
      const daysLeft = Math.ceil((new Date(m.expiry) - new Date(todayStr)) / 86400000)
      const waNum = parsePhoneToWA(m.phone)
      const waText = `Hi ${m.name}, your gym membership at ${config.gymName||'the gym'} expires in ${daysLeft} day(s) on ${m.expiry}. Please renew soon!`
      return `<tr>
        <td><strong>${esc(m.name)}</strong></td>
        <td>${esc(m.phone)}</td>
        <td style="color:var(--yellow);font-weight:700">${m.expiry} <span style="font-size:0.75rem;color:var(--muted)">(${daysLeft}d)</span></td>
        <td>${waNum ? `<a href="https://wa.me/${waNum}?text=${encodeURIComponent(waText)}" target="_blank" class="wa-btn">💬 Remind</a>` : "-"}</td>
      </tr>`
    }).join("")
  } else exBox.style.display = "none"

  // Approvals
  const appBox = document.getElementById("approvals-box"), appTab = document.getElementById("approvalsTable")
  if (pending.length > 0) {
    appBox.style.display = "block"
    appTab.innerHTML = pending.map(m => `<tr><td><strong>${esc(m.name)}</strong></td><td>${m.plan}m / PKR ${m.fee}</td><td><button class="tbtn tbtn-edit" onclick="viewScreenshot('${m.id}')">🧾 View</button></td><td><button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅ Apprv</button></td></tr>`).join("")
  } else appBox.style.display = "none"

  drawCharts()
}

function drawCharts() {
  if (revChart) revChart.destroy(); if (attChart) attChart.destroy()
  Chart.defaults.color = "#94a3b8"; Chart.defaults.font.family = "Inter"

  // Build real per-month data for the last 6 months
  const monthKeys = [], monthLabels = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    monthKeys.push(d.toISOString().substring(0, 7))
    monthLabels.push(d.toLocaleString("en-US", { month: "short", year: "2-digit" }))
  }

  const revData = monthKeys.map(k =>
    members.filter(m => m.date && m.date.startsWith(k)).reduce((s, m) => s + (+m.fee || 0), 0)
  )
  const expData = monthKeys.map(k =>
    expenses.filter(e => e.date && e.date.startsWith(k)).reduce((s, e) => s + (+e.amount || 0), 0)
  )
  const attData = monthKeys.map(k =>
    members.reduce((s, m) => s + (m.attendLog || []).filter(d => d.startsWith(k)).length, 0)
  )

  revChart = new Chart(document.getElementById('revenueChart').getContext('2d'), {
    type: 'line', data: { labels: monthLabels,
      datasets: [
        { label: 'Revenue', data: revData, borderColor: '#10b981', backgroundColor: '#10b98122', fill: true, tension: 0.4 },
        { label: 'Expenses', data: expData, borderColor: '#ef4444', backgroundColor: 'transparent', tension: 0.4, borderDash: [5,5] }
      ]
    }, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:true, position:'bottom'}} }
  })

  attChart = new Chart(document.getElementById('attendanceChart').getContext('2d'), {
    type: 'bar', data: { labels: monthLabels,
      datasets: [{ label: 'Visits', data: attData, backgroundColor: '#3b82f6', borderRadius: 4 }]
    }, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:false}} }
  })
}

// ═══════════════════════════════════════════════════════
//  ATTENDANCE REGISTER PAGE
// ═══════════════════════════════════════════════════════
async function renderAttendance() {
  const selDate = document.getElementById("att-date").value || todayISO()
  const search  = (document.getElementById("att-search")?.value || "").toLowerCase()
  const today   = todayISO()

  // Filter by search
  const list = members.filter(m => !search || m.name.toLowerCase().includes(search) || m.id.toLowerCase().includes(search))

  // Count how many visited today
  const todayCount = members.filter(m => m.attendLog && m.attendLog.includes(selDate)).length
  setText("att-today-count", todayCount)

  const tbody = document.getElementById("attendanceTable")
  if (!list.length) return tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">No members</td></tr>`

  tbody.innerHTML = list.map(m => {
    const isExp = m.expiry < today
    const visitedToday = m.attendLog && m.attendLog.includes(selDate)
    const badge = isExp ? `<span class="badge expired">🔴 Expired</span>` : (m.plan === "trial" ? `<span class="badge trial">🟡 Trial</span>` : `<span class="badge active">🟢 Active</span>`)
    const todayMark = visitedToday
      ? `<span style="color:var(--green);font-weight:700">✅ Present</span>`
      : `<span style="color:var(--muted)">—</span>`

    return `<tr>
      <td style="font-size:0.75rem;color:var(--muted)">${m.id}</td>
      <td><strong>${esc(m.name)}</strong><br><span style="font-size:0.78rem;color:var(--muted)">${esc(m.phone)}</span></td>
      <td>${badge}</td>
      <td>${todayMark}</td>
      <td style="font-weight:700">${m.visits||0}</td>
      <td>
        ${visitedToday
          ? `<button class="tbtn tbtn-delete" onclick="undoVisitDate('${m.id}','${selDate}')">↩ Undo</button>`
          : `<button class="tbtn tbtn-attend" onclick="markVisitDate('${m.id}','${selDate}')">${isExp?"⚠️":"📌"} Mark</button>`
        }
      </td>
    </tr>`
  }).join("")
}

async function markVisitDate(id, date) {
  const m = members.find(x => x.id === id); if (!m) return
  if (m.expiry < todayISO()) return toast(`⚠️ ${m.name} is Expired!`, "var(--red)")
  if (!m.attendLog) m.attendLog = []
  if (!m.attendLog.includes(date)) m.attendLog.push(date)
  m.visits = m.attendLog.length
  await idbPut("members", m); renderAttendance(); toast(`📌 ${m.name} marked Present!`, "var(--blue)")
}

async function undoVisitDate(id, date) {
  const m = members.find(x => x.id === id); if (!m) return
  m.attendLog = (m.attendLog || []).filter(d => d !== date)
  m.visits = m.attendLog.length
  await idbPut("members", m); renderAttendance(); toast(`↩ Removed ${m.name}'s mark`, "var(--red)")
}

function printAttendance() {
  const selDate = document.getElementById("att-date").value || todayISO()
  const visited = members.filter(m => m.attendLog && m.attendLog.includes(selDate))
  const p = document.getElementById("print-container")
  p.innerHTML = `
    <div class="print-head">
      <div class="print-title">${config.gymName || "Gym Manager"}</div>
      <div class="print-meta">Daily Attendance Register — ${selDate}</div>
    </div>
    <table border="1" cellpadding="8" style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th>#</th><th>ID</th><th>Name</th><th>Phone</th><th>Plan</th><th>Expiry</th><th>Signature</th></tr></thead>
      <tbody>
        ${members.map((m, i) => {
          const ck = m.attendLog && m.attendLog.includes(selDate) ? "✓" : ""
          return `<tr><td>${i+1}</td><td>${m.id}</td><td>${m.name}</td><td>${m.phone}</td><td>${m.plan}</td><td>${m.expiry}</td><td style="width:100px">${ck}</td></tr>`
        }).join("")}
      </tbody>
    </table>
    <p style="margin-top:20px;font-size:12px">Present: ${visited.length} / Total: ${members.length}</p>`
  window.print()
}
// ═══════════════════════════════════════════════════════
//  MEMBERS RENDER + WHATSAPP
// ═══════════════════════════════════════════════════════
function renderMembers() {
  const search = val("search").toLowerCase(), filter = val("filterStatus"), today = todayISO()

  const list = members.filter(m => {
    let stat = "expired"
    if (m.status === "pending") stat = "pending"
    else if (m.plan === "trial" && m.expiry >= today) stat = "trial"
    else if (m.expiry >= today) stat = "active"
    if (filter !== "all" && filter !== stat) return false
    return !search || m.name.toLowerCase().includes(search) || m.phone.includes(search) || m.id.toLowerCase().includes(search)
  })

  const tbody = document.getElementById("membersTable")
  if (!list.length) return tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">No members found</td></tr>`

  tbody.innerHTML = list.map(m => {
    const isExp = m.expiry < today
    let badge="", actBtn=""
    if (m.status==="pending")          { badge=`<span class="badge pending">⏳ Pending</span>`; actBtn=`<button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅</button>` }
    else if (isExp)                    { badge=`<span class="badge expired">🔴 Expired</span>`; actBtn=`<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">💳</button>` }
    else if (m.plan==="trial")         { badge=`<span class="badge trial">🟡 Trial</span>`;  actBtn=`<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">⬆️</button>` }
    else                               { badge=`<span class="badge active">🟢 Active</span>` }

    const waNum  = parsePhoneToWA(m.phone)
    const waText = isExp
      ? `Hi ${m.name}, your gym subscription at ${config.gymName||'the gym'} expired on ${m.expiry}. Please renew to continue!`
      : `Hi ${m.name}, hope you are having a great workout week at ${config.gymName||'the gym'}! 🏋️`
    const waHTML = waNum ? `<a href="https://wa.me/${waNum}?text=${encodeURIComponent(waText)}" target="_blank" class="wa-btn">💬</a>` : ""

    return `<tr>
      <td style="font-size:0.75rem;color:var(--muted)">${m.id}</td>
      <td><strong>${esc(m.name)}</strong></td>
      <td><span style="font-size:0.8rem">${esc(m.phone)}</span>${waHTML}</td>
      <td>${m.plan==="trial"?"Trial":m.plan+"m"}<br><small>PKR ${(+m.fee).toLocaleString()}</small></td>
      <td style="color:${isExp?'var(--red)':'var(--text)'};font-weight:600">${m.expiry}</td>
      <td><span style="font-weight:700;margin-right:4px">${m.visits||0}</span><button class="tbtn tbtn-attend" onclick="addVisit('${m.id}')">+1</button></td>
      <td>${actBtn}<button class="tbtn tbtn-edit" onclick="openEditModal('${m.id}')">✏️</button><button class="tbtn tbtn-delete" onclick="removeMember('${m.id}')">🗑️</button></td>
    </tr>`
  }).join("")
}

function parsePhoneToWA(phone) {
  let p = phone.replace(/[^0-9]/g, "")
  if (p.startsWith("00")) p = p.substring(2)
  if (p.startsWith("0"))  p = "92" + p.substring(1)
  return p
}

// ═══════════════════════════════════════════════════════
//  CRUD
// ═══════════════════════════════════════════════════════
function openAddModal() {
  setText("modal-title", "➕ Add Member"); document.getElementById("m-edit-id").value = ""
  ;["name","phone","fee","notes"].forEach(id => document.getElementById("m-"+id).value="")
  document.getElementById("m-plan").value = "trial"; document.getElementById("m-date").value = todayISO()
  handlePlanChange(); hide("qr-section"); show("modal-overlay")
}

function openEditModal(id) {
  const m = members.find(x => x.id === id); if (!m) return
  setText("modal-title","✏️ Edit Member"); document.getElementById("m-edit-id").value=m.id
  document.getElementById("m-name").value=m.name; document.getElementById("m-phone").value=m.phone; document.getElementById("m-fee").value=m.fee
  document.getElementById("m-plan").value=m.plan; document.getElementById("m-date").value=m.date||todayISO(); document.getElementById("m-expiry").value=m.expiry
  document.getElementById("m-notes").value=m.notes||""
  show("qr-section"); setText("qr-id-text", m.id)
  if (window.innerWidth > 768) new QRious({ element: document.getElementById("member-qr"), value: m.id, size: 140 })
  show("modal-overlay")
}

document.getElementById("m-plan").addEventListener("change", handlePlanChange)
function handlePlanChange() {
  const plan = document.getElementById("m-plan").value
  const start = new Date(document.getElementById("m-date").value || new Date())
  if (plan==="trial") start.setDate(start.getDate()+7)
  else start.setMonth(start.getMonth()+parseInt(plan))
  document.getElementById("m-expiry").value = start.toISOString().split("T")[0]
}

function closeAddModal() { hide("modal-overlay") }
function closeModal(e)   { if (e.target.id==="modal-overlay") closeAddModal() }

async function saveMember() {
  const id=val("m-edit-id"), name=val("m-name"), phone=val("m-phone"), fee=val("m-fee"), plan=val("m-plan"), date=val("m-date"), exp=val("m-expiry"), notes=val("m-notes")
  if (!name||!phone||!fee) return toast("⚠️ Required fields!","var(--red)")
  
  if (id) {
    const idx = members.findIndex(x=>x.id===id)
    const updated = { ...members[idx], name, phone, fee, plan, date, expiry:exp, notes }
    members[idx] = updated; await idbPut("members", updated); toast("✏️ Updated!")
  } else {
    const m = { id:"GYM-"+Math.floor(Math.random()*90000+10000), name, phone, fee, plan, date, expiry:exp, visits:0, status:"active", notes }
    members.push(m); await idbPut("members", m); toast("✅ Added!")
  }
  closeAddModal(); renderMembers(); renderDashboard()
}

async function removeMember(id) {
  if (!confirm("Delete permanent?")) return
  await idbDelete("members", id); members = members.filter(x=>x.id!==id); renderMembers(); renderDashboard()
}

async function addVisit(id) {
  const m=members.find(x=>x.id===id); if(!m)return
  if (m.expiry<todayISO()) return toast("⚠️ Expired!","var(--red)")
  m.visits=(m.visits||0)+1; await idbPut("members",m); renderMembers(); toast("📌 Logged!","var(--blue)")
}

function printRoutine() {
  const mName=val("m-name"), mNotes=val("m-notes")
  if (!mName||!mNotes) return toast("Add a name and routine first!","var(--red)")
  const p=document.getElementById("print-container")
  p.innerHTML=`<div class="print-head"><div class="print-title">${config.gymName||"Gym Manager"}</div><div class="print-meta">Diet & Workout Routine</div></div><div style="font-size:20px;font-weight:700;margin-bottom:10px">Name: ${mName}</div><div class="print-notes">${mNotes}</div>`
  window.print()
}

// ═══════════════════════════════════════════════════════
//  FINANCES
// ═══════════════════════════════════════════════════════
function renderFinances() {
  let total = 0
  const sorted = [...expenses].sort((a,b) => new Date(b.date)-new Date(a.date))
  const tbody = document.getElementById("expensesTable")
  if (!sorted.length) {
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">No expenses logged</td></tr>`
  } else {
    tbody.innerHTML = sorted.map(e => {
      total += (+e.amount)
      return `<tr><td style="font-size:0.8rem">${e.date}</td><td><strong>${esc(e.title)}</strong></td><td><span class="badge" style="background:var(--surface2)">${e.cat}</span></td><td style="color:var(--red);font-weight:600">PKR ${(+e.amount).toLocaleString()}</td><td><button class="tbtn tbtn-delete" onclick="removeExpense('${e.id}')">🗑️</button></td></tr>`
    }).join("")
  }
  document.getElementById("total-exp-label").textContent = "PKR " + total.toLocaleString()
}

async function addExpense() {
  const date=val("exp-date"), amount=val("exp-amount"), title=val("exp-title"), cat=val("exp-category")
  if (!date||!amount||!title) return toast("⚠️ Date, Amount & Title required","var(--red)")
  const e = { id:"EXP-"+Date.now(), date, amount, title, cat }
  await idbPut("expenses", e); expenses.push(e)
  document.getElementById("exp-amount").value=""; document.getElementById("exp-title").value=""
  renderFinances(); toast("📉 Expense logged!")
}

async function removeExpense(id) {
  if (!confirm("Delete?")) return
  await idbDelete("expenses", id); expenses = expenses.filter(x=>x.id!==id); renderFinances()
}

// ═══════════════════════════════════════════════════════
//  CHECKOUT & APPROVALS (PAYMENT GATEWAY)
// ═══════════════════════════════════════════════════════
function openCheckout(id) {
  const m=members.find(x=>x.id===id); if(!m)return
  currentCheckoutId=m.id; hide("screen-app"); show("screen-checkout")
  setText("chk-member-name",m.name+" ("+m.phone+")"); setText("chk-amount","PKR "+(+m.fee).toLocaleString())
}
function cancelCheckout() { hide("screen-checkout"); show("screen-app"); currentCheckoutId=null }

async function goToPaymentGateway() {
  if (!config.stripeLink) return alert("⚠️ Please configure a Payment Gateway Link in Settings first.")
  
  const m = members.find(x => x.id === currentCheckoutId)
  if (!m) return

  // 1. Mark them as pending verification
  m.status = "pending"
  await idbPut("members", m)

  // 2. Open the gateway link. Try to append the member ID for easier tracking.
  let link = config.stripeLink
  if (link.includes("?")) link += "&ref=" + m.id
  else link += "?ref=" + m.id
  
  window.open(link, "_blank")
  
  toast("Redirecting to Secure Gateway... Admin will approve once paid.", "var(--blue)")
  cancelCheckout()
  renderMembers()
  renderDashboard()
}

function viewScreenshot(id) {
  // We no longer store screenshots. Just prompt the admin to check their stripe/bank app.
  alert(`Please check your Payment Gateway (e.g., Stripe or Bank App) to confirm you received payment for Member ID: ${id}. Once confirmed, click 'Apprv'.`)
}
function approvePaymentDirect(id){document.getElementById("approve-id").value=id;approvePayment()}
async function approvePayment(){
  const m=members.find(x=>x.id===document.getElementById("approve-id").value)
  const months=(m.plan==="trial")?1:parseInt(m.plan); m.plan=String(months)
  let s=new Date(m.expiry>todayISO()?m.expiry:todayISO()); s.setMonth(s.getMonth()+months); m.expiry=s.toISOString().split("T")[0]
  m.status="active"; m.paymentProof=null; await idbPut("members",m); hide("image-modal"); toast(`✅ Approved! Expiry: ${m.expiry}`); renderMembers(); renderDashboard()
}
async function rejectPayment(){
  const m=members.find(x=>x.id===document.getElementById("approve-id").value); m.status="active"; m.paymentProof=null
  await idbPut("members",m); hide("image-modal"); toast("❌ Rejected.","var(--red)"); renderMembers(); renderDashboard()
}

// ═══════════════════════════════════════════════════════
//  QR SCANNER
// ═══════════════════════════════════════════════════════
function openScanner() {
  closeSidebar(); show("scanner-modal"); hide("scan-result")
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader",{fps:10,qrbox:{width:250,height:250}},false)
  html5QrcodeScanner.render(onScanSuccess,()=>{})
}
function closeScanner(){
  hide("scanner-modal"); if(html5QrcodeScanner){html5QrcodeScanner.clear().catch(e=>{}); html5QrcodeScanner=null}
}
async function onScanSuccess(decodedText){
  if(html5QrcodeScanner){html5QrcodeScanner.clear();html5QrcodeScanner=null}
  document.getElementById("qr-reader").innerHTML=""; const m=members.find(x=>x.id===decodedText); show("scan-result")
  if(!m){setText("scan-name","Unknown");setText("scan-status","Not found.");document.getElementById("scan-result").style.cssText="background:#7f1d1d;border-color:#ef4444"}
  else{
    setText("scan-name",m.name)
    if(m.expiry<todayISO()){document.getElementById("scan-result").style.cssText="background:#7f1d1d;border-color:#ef4444";setText("scan-status","⚠️ Expired.")}
    else{
      m.visits=(m.visits||0)+1; await idbPut("members",m); 
      document.getElementById("scan-result").style.cssText="background:#064e3b;border-color:#10b981";setText("scan-status","✅ Logged!")
      
      // Auto WhatsApp Notification if online
      if (navigator.onLine) {
        const waNum = parsePhoneToWA(m.phone)
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const text = `Hi ${m.name}, your attendance at ${config.gymName || 'the gym'} is logged! 🏋️ Time: ${time}`
        window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, "_blank")
      }
    }
  }
  playSound(); setTimeout(closeScanner,3000)
}
function playSound(){const a=document.getElementById("beep");a.currentTime=0;a.play().catch(()=>{})}

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
function saveGymName(){config.gymName=val("set-gymname");saveConfig();setText("sidebar-gymname",config.gymName);toast("🏢 Gym name saved!")}
function saveBankDetails(){config.bankDetails=document.getElementById("set-bank").value;config.stripeLink=document.getElementById("set-stripe").value;saveConfig();toast("💳 Payment settings saved!")}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function saveConfig(){localStorage.setItem(KEY_CONFIG,JSON.stringify(config))}
function val(id){return document.getElementById(id)?.value?.trim()||""}
function setText(id,t){const e=document.getElementById(id);if(e)e.textContent=t}
function show(id){document.getElementById(id)?.classList.remove("hidden")}
function hide(id){document.getElementById(id)?.classList.add("hidden")}
function esc(str){return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")}
function todayISO(){return new Date().toISOString().split("T")[0]}
function showErr(id,msg){const el=document.getElementById(id);el.textContent=msg;el.classList.remove("hidden")}
function toggleSidebar(){document.getElementById("sidebar").classList.toggle("open")}
function closeSidebar(){document.getElementById("sidebar").classList.remove("open")}

// ═══════════════════════════════════════════════════════
//  V11: SOFTWARE SUBSCRIPTION LOGIC
// ═══════════════════════════════════════════════════════
function checkAppSubscription() {
  if (!config || !config.appSubscriptionExpiry) return false
  const today = new Date().toISOString().split("T")[0]
  if (today > config.appSubscriptionExpiry) {
    hide("screen-app"); hide("screen-setup"); hide("screen-login"); hide("screen-member"); hide("screen-register")
    show("screen-software-lock")
    return true
  }
  return false
}

function manualUnlock() {
  const code = val("unlock-code").toUpperCase().trim()
  const result = _redeemCode(code)
  if (result) {
    saveConfig(); toast(result)
    hide("screen-software-lock"); initApp()
  } else {
    toast("❌ Invalid Activation Code!","var(--red)")
  }
}

function renderSubscriptionStatus() {
  const el = document.getElementById("sub-expiry-label")
  if (!el) return
  const expiry = config.appSubscriptionExpiry
  if (!expiry) { el.textContent = "No subscription data found."; return }
  const today = todayISO()
  if (expiry === LIFETIME_EXPIRY) {
    el.innerHTML = `<span style="color:var(--green);font-weight:700">✅ Lifetime / Unlimited Access</span>`
  } else if (today > expiry) {
    el.innerHTML = `<span style="color:var(--red);font-weight:700">🔴 Subscription expired on ${expiry}.</span> Enter an activation code below to renew.`
  } else {
    const days = Math.ceil((new Date(expiry) - new Date(today)) / 86400000)
    el.innerHTML = `<span style="color:var(--green);font-weight:700">🟢 Active</span> — expires on <strong>${expiry}</strong> <span style="color:var(--muted)">(${days} day${days===1?'':'s'} remaining)</span>`
  }
}

function applyUnlockCode() {
  const code = (document.getElementById("sub-unlock-code")?.value || "").toUpperCase().trim()
  if (!code) return toast("⚠️ Enter an activation code","var(--red)")
  const result = _redeemCode(code)
  if (result) {
    saveConfig(); renderSubscriptionStatus()
    document.getElementById("sub-unlock-code").value = ""
    toast(result)
  } else {
    toast("❌ Invalid Activation Code!","var(--red)")
  }
}

function _redeemCode(code) {
  if (code === "500596") {
    config.appSubscriptionExpiry = LIFETIME_EXPIRY
    return "🎉 Referral Code Accepted! Lifetime Access Activated!"
  } else if (code === "GYM-PRO-UNLOCK") {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    config.appSubscriptionExpiry = d.toISOString().split("T")[0]
    return "✅ Software Unlocked for 30 Days!"
  }
  return null
}


function openSoftwarePayment() {
  // Use the stripe link from Settings if configured, or fallback to WhatsApp support
  const link = config.stripeLink
  if (link) {
    const ref = encodeURIComponent(config.gymName || "GymOwner")
    window.open(link + (link.includes("?") ? "&ref=" : "?ref=") + ref + "_Sub5", "_blank")
  } else {
    const msg = encodeURIComponent("Hi, I want to subscribe to Gym Manager Pro for $5/month. Gym: " + (config.gymName || ""))
    window.open("https://wa.me/92?text=" + msg, "_blank")
  }
}

function downloadQR(){const c=document.getElementById("member-qr"),a=document.createElement("a");a.href=c.toDataURL("image/png");a.download="QR.png";a.click()}
function exportCSV(){if(!members.length)return toast("No data");const b=new Blob(["ID,Name,Phone,Plan,Fee,Expiry,Visits\n"+members.map(m=>`${m.id},${m.name},${m.phone},${m.plan},${m.fee},${m.expiry},${m.visits||0}`).join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="members.csv";a.click()}

function triggerCSVImport(){document.getElementById("csv-import-input").click()}
async function importMembersFromCSV(e) {
  const file = e.target.files[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = async (event) => {
    const text = event.target.result; const lines = text.split("\n").filter(l=>l.trim().length > 0)
    if (lines.length < 2) return toast("❌ Invalid CSV format","var(--red)")
    let count = 0
    for(let i=1; i<lines.length; i++){
      const cols = lines[i].split(",").map(c=>c.trim())
      if(cols.length < 2) continue
      const m = {
        id: cols[0] || "M-"+Math.floor(Math.random()*9999), name: cols[1], phone: cols[2]||"",
        plan: cols[3]||"Standard", fee: parseFloat(cols[4])||0, expiry: cols[5]||todayISO(),
        visits: parseInt(cols[6])||0, payments: []
      }
      await idbPut("members", m); count++
    }
    members = await idbGetAll("members"); renderMembers(); renderDashboard()
    toast(`✅ Imported ${count} members successfully!`)
    e.target.value = ""
  }
  reader.readAsText(file)
}

let tId;function toast(msg,bg="var(--green)"){
  const el=document.getElementById("toast");el.textContent=msg;el.style.background=bg;el.style.color=bg==="var(--green)"?"#000":"#fff"
  el.classList.add("show");clearTimeout(tId);tId=setTimeout(()=>el.classList.remove("show"),2500)
}

if("serviceWorker"in navigator)navigator.serviceWorker.register("service-worker.js")
initApp()
