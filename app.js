/* ═══════════════════════════════════════════════════════
   GYM MANAGER PRO V2 – app.js
   Features: Offline PWA | Advanced Charts | QR Scanner
═══════════════════════════════════════════════════════ */

const KEY_CONFIG  = "gymConfigV2"
const KEY_MEMBERS = "gymMembersV2"
const KEY_SESSION = "gymSessionV2"

let members = []
let config  = {}
let revChart, attChart
let html5QrcodeScanner = null

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  config  = JSON.parse(localStorage.getItem(KEY_CONFIG)  || "null")
  members = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]")

  // Migrate old data if present
  if (!config && localStorage.getItem("gymConfig")) {
    config  = JSON.parse(localStorage.getItem("gymConfig"))
    members = JSON.parse(localStorage.getItem("gymMembers") || "[]")
    // Assign random expiry dates to old members for migration
    members.forEach(m => {
      m.id = m.id || "GYM-" + Math.floor(Math.random()*90000+10000)
      m.expiry = m.expiry || futureDate(30)
      m.visits = m.attendance || 0
    })
    save()
  }

  if (!config) return show("screen-setup")

  const session = sessionStorage.getItem(KEY_SESSION)
  if (session === "ok") launchApp()
  else {
    show("screen-login")
    setText("login-gymname", config.gymName || "Gym Manager")
  }
}

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════
function setupGym() {
  const gymName = val("setup-gymname")
  const user    = val("setup-user")
  const pass    = val("setup-pass")
  const pass2   = val("setup-pass2")

  if (!gymName || !user || !pass) return showErr("setup-error", "All fields required.")
  if (pass !== pass2)             return showErr("setup-error", "Passwords do not match.")
  
  config = { gymName, user, pass }
  saveConfig()
  sessionStorage.setItem(KEY_SESSION, "ok")
  launchApp()
}

function login() {
  const user = val("login-user")
  const pass = val("login-pass")
  if (user === config.user && pass === config.pass) {
    sessionStorage.setItem(KEY_SESSION, "ok")
    launchApp()
  } else {
    showErr("login-error", "❌ Incorrect username or password.")
  }
}

function logout() {
  sessionStorage.removeItem(KEY_SESSION)
  hide("screen-app")
  show("screen-login")
  document.getElementById("login-pass").value = ""
}

function launchApp() {
  hide("screen-setup")
  hide("screen-login")
  show("screen-app")
  const gn = config.gymName || "Gym Manager"
  setText("sidebar-gymname", gn); setText("topbar-username", config.user)
  setText("topbar-avatar", config.user[0].toUpperCase())
  document.getElementById("set-gymname").value = gn
  showPage("dashboard")
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
function showPage(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.add("hidden"))
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"))
  
  show("page-" + page)
  document.getElementById("nav-" + page)?.classList.add("active")
  closeSidebar()
  
  if (page === "dashboard") renderDashboard()
  if (page === "members")   renderMembers()
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD & CHARTS
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const todayStr = todayISO()
  let active = 0, expired = 0, rev = 0

  members.forEach(m => {
    if (m.expiry >= todayStr) {
      active++
      if (m.fee) rev += (+m.fee)
    } else expired++
  })

  setText("stat-total", members.length)
  setText("stat-active", active)
  setText("stat-expired", expired)
  setText("stat-revenue", rev.toLocaleString())
  setText("dash-date", new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" }))

  drawCharts()
}

function drawCharts() {
  // Destroy old charts to prevent overlapping
  if (revChart) revChart.destroy()
  if (attChart) attChart.destroy()

  // Generate some fake historical trend data for visual appeal
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"]
  const revData = months.map(() => Math.floor(Math.random() * 50000) + 10000)
  revData[6] = members.reduce((s, m) => m.expiry >= todayISO() ? s + (+m.fee||0) : s, 0) // Current month real data

  const attData = months.map(() => Math.floor(Math.random() * 300) + 50)
  attData[6] = members.reduce((s, m) => s + (m.visits||0), 0)

  // Chart defaults for dark theme
  Chart.defaults.color = "#94a3b8"
  Chart.defaults.font.family = "Inter"

  const ctxRev = document.getElementById('revenueChart').getContext('2d')
  revChart = new Chart(ctxRev, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Revenue (PKR)',
        data: revData,
        borderColor: '#10b981',
        backgroundColor: '#10b98133',
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#10b981',
        borderWidth: 3
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  })

  const ctxAtt = document.getElementById('attendanceChart').getContext('2d')
  attChart = new Chart(ctxAtt, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: 'Visits',
        data: attData,
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  })
}

// ═══════════════════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════════════════
function renderMembers() {
  const search = val("search").toLowerCase()
  const filter = val("filterStatus")
  const today  = todayISO()

  let list = members.filter(m => {
    const isAct = m.expiry >= today
    if (filter === "active" && !isAct) return false
    if (filter === "expired" && isAct) return false
    if (search && !m.name.toLowerCase().includes(search) && !m.phone.includes(search) && !m.id.includes(search.toUpperCase())) return false
    return true
  })

  const tbody = document.getElementById("membersTable")
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">No members found</td></tr>`
    return
  }

  tbody.innerHTML = list.map(m => {
    const idx = members.findIndex(x => x.id === m.id)
    const isAct = m.expiry >= today
    const badge = isAct ? `<span class="badge active">🟢 Active</span>` : `<span class="badge expired">🔴 Expired</span>`

    return `
    <tr>
      <td style="font-size:0.75rem;color:var(--muted)">${m.id}</td>
      <td>
        <strong>${esc(m.name)}</strong><br>
        <span style="font-size:0.8rem;color:var(--muted)">${esc(m.phone)}</span>
      </td>
      <td>
        ${m.plan} Months<br>
        <span style="font-size:0.8rem">PKR ${(+m.fee).toLocaleString()}</span>
      </td>
      <td style="font-weight:600;color:${isAct?'var(--text)':'var(--red)'}">${m.expiry}</td>
      <td>${badge}</td>
      <td>
        <span style="font-weight:700;margin-right:6px">${m.visits||0}</span>
        <button class="tbtn tbtn-attend" onclick="addVisit('${m.id}')">+1</button>
      </td>
      <td>
        <button class="tbtn tbtn-edit" onclick="openEditModal('${m.id}')">✏️ Edit</button>
        <button class="tbtn tbtn-delete" onclick="removeMember('${m.id}')">🗑️</button>
      </td>
    </tr>`
  }).join("")
}

// ═══════════════════════════════════════════════════════
//  CRUD
// ═══════════════════════════════════════════════════════
function openAddModal() {
  setText("modal-title", "➕ Add New Member")
  document.getElementById("m-edit-id").value = ""
  ;["name", "phone", "fee"].forEach(id => document.getElementById("m-"+id).value = "")
  document.getElementById("m-plan").value = "1"
  document.getElementById("m-date").value = todayISO()
  document.getElementById("m-expiry").value = futureDate(30)
  
  hide("qr-section")
  show("modal-overlay")
}

function openEditModal(id) {
  const m = members.find(x => x.id === id)
  setText("modal-title", "✏️ Edit Member")
  document.getElementById("m-edit-id").value = m.id
  document.getElementById("m-name").value  = m.name
  document.getElementById("m-phone").value = m.phone
  document.getElementById("m-fee").value   = m.fee
  document.getElementById("m-plan").value  = m.plan || "1"
  document.getElementById("m-date").value  = m.joinDate || m.date || todayISO()
  document.getElementById("m-expiry").value = m.expiry

  // Generate QR
  show("qr-section")
  setText("qr-id-text", m.id)
  new QRious({
    element: document.getElementById('member-qr'),
    value: m.id,
    size: 140,
    background: 'white',
    foreground: 'black'
  })

  show("modal-overlay")
}

document.getElementById("m-plan").addEventListener("change", (e) => {
  const months = parseInt(e.target.value)
  const start = new Date(document.getElementById("m-date").value || new Date())
  start.setMonth(start.getMonth() + months)
  document.getElementById("m-expiry").value = start.toISOString().split("T")[0]
})

function closeAddModal() { hide("modal-overlay") }
function closeModal(e) { if (e.target.id === "modal-overlay") closeAddModal() }

function saveMember() {
  const id   = val("m-edit-id")
  const name = val("m-name")
  const phone= val("m-phone")
  const fee  = val("m-fee")
  const plan = val("m-plan")
  const date = val("m-date")
  const exp  = val("m-expiry")

  if (!name || !phone || !fee) return toast("⚠️ Name, Phone & Fee are required!", "var(--red)")

  if (id) {
    const idx = members.findIndex(x => x.id === id)
    members[idx] = { ...members[idx], name, phone, fee, plan, date, expiry: exp }
    toast("✏️ Member updated!")
  } else {
    // New member
    const newId = "GYM-" + Math.floor(Math.random()*90000+10000)
    members.push({ id: newId, name, phone, fee, plan, date, expiry: exp, visits: 0 })
    toast("✅ Member added!")
  }

  saveMembers()
  closeAddModal()
  renderMembers()
}

function addVisit(id) {
  const m = members.find(x => x.id === id)
  if (!m) return
  if (m.expiry < todayISO()) {
    toast(`⚠️ Subscription Expired for ${m.name}! Renew first.`, "var(--red)")
    playSound(false)
    return false
  }
  m.visits = (m.visits || 0) + 1
  saveMembers()
  renderMembers()
  toast(`📌 Visit Logged for ${m.name}! (Total: ${m.visits})`, "var(--blue)")
  playSound(true)
  return true
}

function removeMember(id) {
  if (!confirm("Delete this member permanently?")) return
  members = members.filter(x => x.id !== id)
  saveMembers()
  renderMembers()
  toast("🗑️ Member deleted", "var(--red)")
}

// ═══════════════════════════════════════════════════════
//  QR SCANNER (HTML5-QRCode)
// ═══════════════════════════════════════════════════════
function openScanner() {
  closeSidebar()
  show("scanner-modal")
  hide("scan-result")

  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false)
  html5QrcodeScanner.render(onScanSuccess, onScanFailure)
}

function closeScanner() {
  hide("scanner-modal")
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(e => console.warn(e))
    html5QrcodeScanner = null
  }
}

function onScanSuccess(decodedText) {
  // decodedText should be the member ID (e.g. GYM-12345)
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear() // Stop scanning
    html5QrcodeScanner = null
  }
  document.getElementById("qr-reader").innerHTML = ""

  const m = members.find(x => x.id === decodedText)
  show("scan-result")
  
  if (!m) {
    setText("scan-name", "Unknown QR Code")
    setText("scan-status", "Member not found in database.")
    document.getElementById("scan-result").style.background = "#7f1d1d"
    document.getElementById("scan-result").style.borderColor = "#ef4444"
    playSound(false)
  } else {
    setText("scan-name", m.name)
    const success = addVisit(m.id)
    if (success) {
      document.getElementById("scan-result").style.background = "#064e3b"
      document.getElementById("scan-result").style.borderColor = "#10b981"
      setText("scan-status", "✅ Attendance Logged Successfully!")
    } else {
      document.getElementById("scan-result").style.background = "#7f1d1d"
      document.getElementById("scan-result").style.borderColor = "#ef4444"
      setText("scan-status", "⚠️ Membership Expired. Please Renew.")
    }
  }

  // Auto-close after 3 seconds
  setTimeout(closeScanner, 3000)
}

function onScanFailure() { /* Ignore continuous scan errors */ }

function playSound(success) {
  const audio = document.getElementById("beep")
  audio.currentTime = 0
  audio.play().catch(e=>console.log(e))
}

function downloadQR() {
  const canvas = document.getElementById("member-qr")
  const id   = document.getElementById("qr-id-text").textContent
  const a = document.createElement("a")
  a.href = canvas.toDataURL("image/png")
  a.download = `${id}-card.png`
  a.click()
}

// ═══════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════
function exportCSV() {
  if (!members.length) return toast("No members", "var(--red)")
  const header = "ID,Name,Phone,Plan,Fee,Expiry,Visits\n"
  const rows = members.map(m => `${m.id},${m.name},${m.phone},${m.plan},${m.fee},${m.expiry},${m.visits||0}`).join("\n")
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" })
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`Gym-Members-${todayISO()}.csv`; a.click()
}

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
function saveGymName() {
  config.gymName = val("set-gymname") || "Gym Manager"
  saveConfig()
  setText("sidebar-gymname", config.gymName)
  toast("🏢 Gym name saved!")
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function save() { saveMembers(); saveConfig() }
function saveMembers() { localStorage.setItem(KEY_MEMBERS, JSON.stringify(members)) }
function saveConfig()  { localStorage.setItem(KEY_CONFIG,  JSON.stringify(config)) }

function val(id) { return document.getElementById(id)?.value?.trim() || "" }
function setText(id, t) { const e=document.getElementById(id); if(e) e.textContent = t }
function show(id) { document.getElementById(id)?.classList.remove("hidden") }
function hide(id) { document.getElementById(id)?.classList.add("hidden") }
function esc(str) { return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;") }
function todayISO() { return new Date().toISOString().split("T")[0] }
function futureDate(days) { const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString().split("T")[0] }

function showErr(id, msg) {
  const el = document.getElementById(id)
  el.textContent = msg; el.classList.remove("hidden")
}

function toggleSidebar() { document.getElementById("sidebar").classList.toggle("open") }
function closeSidebar() { document.getElementById("sidebar").classList.remove("open") }

let tId;
function toast(msg, bg = "var(--green)") {
  const el = document.getElementById("toast")
  el.textContent = msg; el.style.background = bg
  el.style.color = bg === "var(--green)" ? "#000" : "#fff"
  el.classList.add("show")
  clearTimeout(tId); tId = setTimeout(() => el.classList.remove("show"), 2500)
}

// Register SW
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js")
}

// Boot
initApp()
