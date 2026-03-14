/* ═══════════════════════════════════════════════════════
   GYM MANAGER PRO V3 – app.js
   Features: Offline PWA | QR Scanner | Trial | Payments
═══════════════════════════════════════════════════════ */

const KEY_CONFIG  = "gymConfigV3"
const KEY_MEMBERS = "gymMembersV3"
const KEY_SESSION = "gymSessionV3"

let members = []
let config  = {}
let revChart, attChart
let html5QrcodeScanner = null
let currentCheckoutId  = null

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  config  = JSON.parse(localStorage.getItem(KEY_CONFIG)  || "null")
  members = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]")

  // Migrate old data
  if (!config && localStorage.getItem("gymConfigV2")) {
    config  = JSON.parse(localStorage.getItem("gymConfigV2"))
    members = JSON.parse(localStorage.getItem("gymMembersV2") || "[]")
    save()
  }

  if (!config) return show("screen-setup")

  if (sessionStorage.getItem(KEY_SESSION) === "ok") launchApp()
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
  if (!gymName || !user || !pass) return showErr("setup-error", "All fields required.")
  if (pass !== val("setup-pass2")) return showErr("setup-error", "Passwords do not match.")
  
  config = { gymName, user, pass, bankDetails: "", stripeLink: "" }
  saveConfig()
  sessionStorage.setItem(KEY_SESSION, "ok")
  launchApp()
}

function login() {
  if (val("login-user") === config.user && val("login-pass") === config.pass) {
    sessionStorage.setItem(KEY_SESSION, "ok"); launchApp()
  } else showErr("login-error", "❌ Incorrect username or password.")
}

function logout() {
  sessionStorage.removeItem(KEY_SESSION); hide("screen-app"); show("screen-login")
  document.getElementById("login-pass").value = ""
}

function launchApp() {
  hide("screen-setup"); hide("screen-login"); show("screen-app")
  const gn = config.gymName || "Gym Manager"
  setText("sidebar-gymname", gn); setText("topbar-username", config.user)
  setText("topbar-avatar", config.user[0].toUpperCase())
  document.getElementById("set-gymname").value = gn
  document.getElementById("set-bank").value = config.bankDetails || ""
  document.getElementById("set-stripe").value = config.stripeLink || ""
  showPage("dashboard")
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
function showPage(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.add("hidden"))
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"))
  show("page-" + page); document.getElementById("nav-" + page)?.classList.add("active")
  closeSidebar()
  if (page === "dashboard") renderDashboard()
  if (page === "members") renderMembers()
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const todayStr = todayISO()
  let act = 0, exp = 0, tri = 0, rev = 0, pending = []

  members.forEach(m => {
    if (m.status === "pending") pending.push(m)
    else if (m.plan === "trial" && m.expiry >= todayStr) tri++
    else if (m.expiry >= todayStr) { act++; if (m.fee) rev += (+m.fee) }
    else exp++
  })

  setText("stat-total", members.length)
  setText("stat-active", act)
  setText("stat-trials", tri)
  setText("stat-expired", exp)
  setText("dash-date", new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" }))

  // Render Approvals Box
  const appBox = document.getElementById("approvals-box")
  const appTab = document.getElementById("approvalsTable")
  if (pending.length > 0) {
    appBox.style.display = "block"
    appTab.innerHTML = pending.map(m => `
      <tr>
        <td><strong>${esc(m.name)}</strong></td>
        <td>${m.plan} Months<br><span style="font-size:0.8rem">PKR ${m.fee}</span></td>
        <td><button class="tbtn tbtn-edit" onclick="viewScreenshot('${m.id}')">🧾 View Image</button></td>
        <td><button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅ Approve</button></td>
      </tr>
    `).join("")
  } else {
    appBox.style.display = "none"
  }

  drawCharts()
}

function drawCharts() {
  if (revChart) revChart.destroy(); if (attChart) attChart.destroy()
  Chart.defaults.color = "#94a3b8"; Chart.defaults.font.family = "Inter"

  const ctxRev = document.getElementById('revenueChart').getContext('2d')
  revChart = new Chart(ctxRev, {
    type: 'line', data: { labels: ["Jan","Feb","Mar","Apr","May","Jun"], datasets: [{
      label: 'Revenue', data: [12000, 19000, 15000, 22000, 30000, members.reduce((s, m) => m.expiry >= todayISO() && m.plan !== "trial" ? s + (+m.fee||0) : s, 0)],
      borderColor: '#10b981', backgroundColor: '#10b98133', fill: true, tension: 0.4
    }]}, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:false}} }
  })

  let attTotal = members.reduce((s, m) => s + (m.visits||0), 0)
  const ctxAtt = document.getElementById('attendanceChart').getContext('2d')
  attChart = new Chart(ctxAtt, {
    type: 'bar', data: { labels: ["Jan","Feb","Mar","Apr","May","Jun"], datasets: [{
      label: 'Visits', data: [50, 80, 120, 90, 150, attTotal], backgroundColor: '#3b82f6', borderRadius: 4
    }]}, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:false}} }
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
    let stat = "expired"
    if (m.status === "pending") stat = "pending"
    else if (m.plan === "trial" && m.expiry >= today) stat = "trial"
    else if (m.expiry >= today) stat = "active"

    if (filter !== "all" && filter !== stat) return false
    if (search && !m.name.toLowerCase().includes(search) && !m.phone.includes(search) && !m.id.includes(search.toUpperCase())) return false
    return true
  })

  const tbody = document.getElementById("membersTable")
  if (!list.length) return tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">No members found</td></tr>`

  tbody.innerHTML = list.map(m => {
    // Determine status badge
    let badge = ""; let actionBtn = ""
    if (m.status === "pending") {
      badge = `<span class="badge pending" onclick="viewScreenshot('${m.id}')">⏳ Pending Appr.</span>`
      actionBtn = `<button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅ Apprv</button>`
    } else if (m.expiry < today) {
      badge = `<span class="badge expired">🔴 Expired</span>`
      actionBtn = `<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">💳 Pay Now</button>`
    } else if (m.plan === "trial") {
      badge = `<span class="badge trial">🟡 Trial</span>`
      actionBtn = `<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">💳 Upgrade</button>`
    } else {
      badge = `<span class="badge active">🟢 Active</span>`
      actionBtn = ""
    }

    return `
    <tr>
      <td style="font-size:0.75rem;color:var(--muted)">${m.id}</td>
      <td><strong>${esc(m.name)}</strong><br><span style="font-size:0.8rem;color:var(--muted)">${esc(m.phone)}</span></td>
      <td>${m.plan === "trial" ? "Trial" : m.plan + " Mon"}<br><span style="font-size:0.8rem">PKR ${(+m.fee).toLocaleString()}</span></td>
      <td style="font-weight:600;color:${m.expiry >= today?'var(--text)':'var(--red)'}">${m.expiry}</td>
      <td>${badge}</td>
      <td><span style="font-weight:700;margin-right:6px">${m.visits||0}</span><button class="tbtn tbtn-attend" onclick="addVisit('${m.id}')">+1</button></td>
      <td>
        ${actionBtn}
        <button class="tbtn tbtn-edit" onclick="openEditModal('${m.id}')">✏️</button>
        <button class="tbtn tbtn-delete" onclick="removeMember('${m.id}')">🗑️</button>
      </td>
    </tr>`
  }).join("")
}

// ═══════════════════════════════════════════════════════
//  CRUD & MODALS
// ═══════════════════════════════════════════════════════
function openAddModal() {
  setText("modal-title", "➕ Add New Member"); document.getElementById("m-edit-id").value = ""
  ;["name", "phone", "fee"].forEach(id => document.getElementById("m-"+id).value = "")
  document.getElementById("m-plan").value = "trial" // Default to trial
  document.getElementById("m-date").value = todayISO()
  handlePlanChange() // sets expiry to +3 days
  hide("qr-section"); show("modal-overlay")
}

function openEditModal(id) {
  const m = members.find(x => x.id === id)
  setText("modal-title", "✏️ Edit Member"); document.getElementById("m-edit-id").value = m.id
  document.getElementById("m-name").value  = m.name; document.getElementById("m-phone").value = m.phone; document.getElementById("m-fee").value   = m.fee
  document.getElementById("m-plan").value  = m.plan; document.getElementById("m-date").value  = m.date; document.getElementById("m-expiry").value = m.expiry
  // Generate QR
  show("qr-section"); setText("qr-id-text", m.id)
  new QRious({ element: document.getElementById('member-qr'), value: m.id, size: 140 })
  show("modal-overlay")
}

document.getElementById("m-plan").addEventListener("change", handlePlanChange)
function handlePlanChange() {
  const plan = document.getElementById("m-plan").value
  const start = new Date(document.getElementById("m-date").value || new Date())
  if (plan === "trial") start.setDate(start.getDate() + 3)
  else start.setMonth(start.getMonth() + parseInt(plan))
  document.getElementById("m-expiry").value = start.toISOString().split("T")[0]
}

function closeAddModal() { hide("modal-overlay") }
function closeModal(e) { if (e.target.id === "modal-overlay") closeAddModal() }

function saveMember() {
  const id=val("m-edit-id"), name=val("m-name"), phone=val("m-phone"), fee=val("m-fee"), plan=val("m-plan"), date=val("m-date"), exp=val("m-expiry")
  if (!name || !phone || !fee) return toast("⚠️ Required fields!", "var(--red)")

  if (id) {
    const idx = members.findIndex(x => x.id === id)
    members[idx] = { ...members[idx], name, phone, fee, plan, date, expiry: exp }
    toast("✏️ Updated!")
  } else {
    members.push({ id: "GYM-" + Math.floor(Math.random()*90000+10000), name, phone, fee, plan, date, expiry: exp, visits: 0, status: "active" })
    toast("✅ Member added!")
  }
  saveMembers(); closeAddModal(); renderMembers(); renderDashboard()
}

function removeMember(id) {
  if (!confirm("Delete permanent?")) return
  members = members.filter(x => x.id !== id); saveMembers(); renderMembers(); renderDashboard()
}

// ═══════════════════════════════════════════════════════
//  CHECKOUT KIOSK SYSTEM (V3)
// ═══════════════════════════════════════════════════════
function openCheckout(id) {
  const m = members.find(x => x.id === id)
  if (!m) return
  currentCheckoutId = m.id
  
  // Hide main app, show checkout
  hide("screen-app")
  show("screen-checkout")
  
  setText("chk-member-name", m.name + " (" + m.phone + ")")
  setText("chk-amount", "PKR " + (+m.fee).toLocaleString())
  setText("chk-bank-details", config.bankDetails || "Admin has not configured bank details yet. Pay at desk.")
  
  // Reset fields
  document.getElementById("chk-screenshot").value = ""
  showChkTab("local") // Default to Local Transfer
}

function cancelCheckout() {
  hide("screen-checkout"); show("screen-app")
  currentCheckoutId = null
}

function showChkTab(tab) {
  if (tab === "local") {
    show("chk-flow-local"); hide("chk-flow-card")
    document.getElementById("tab-local").style.background = "var(--green)"; document.getElementById("tab-local").style.color = "#000"
    document.getElementById("tab-card").style.background = "var(--surface2)"; document.getElementById("tab-card").style.color = "var(--text)"
  } else {
    hide("chk-flow-local"); show("chk-flow-card")
    document.getElementById("tab-card").style.background = "var(--green)"; document.getElementById("tab-card").style.color = "#000"
    document.getElementById("tab-local").style.background = "var(--surface2)"; document.getElementById("tab-local").style.color = "var(--text)"
  }
}

// Upload Screenshot (Base64)
function submitScreenshot() {
  const fileInput = document.getElementById("chk-screenshot")
  if (!fileInput.files[0]) return alert("Please select a screenshot image first.")
  
  const reader = new FileReader()
  reader.onload = function(e) {
    const base64Image = e.target.result
    const m = members.find(x => x.id === currentCheckoutId)
    // Save to member
    m.status = "pending"
    m.paymentProof = base64Image
    
    saveMembers()
    toast("📤 Payment Proof Submitted! Pending Admin Approval.", "var(--blue)")
    cancelCheckout()
    renderMembers(); renderDashboard()
  }
  reader.readAsDataURL(fileInput.files[0])
}

function goToStripe() {
  if (!config.stripeLink) return alert("Gym Admin has not configured the Stripe link yet.")
  window.open(config.stripeLink, "_blank")
}

// ═══════════════════════════════════════════════════════
//  ADMIN APPROVALS
// ═══════════════════════════════════════════════════════
function viewScreenshot(id) {
  const m = members.find(x => x.id === id)
  if (!m || !m.paymentProof) return toast("No image found.", "var(--red)")
  
  document.getElementById("view-screenshot").src = m.paymentProof
  document.getElementById("approve-id").value = m.id
  show("image-modal")
}

function approvePaymentDirect(id) {
  document.getElementById("approve-id").value = id
  approvePayment()
}

function approvePayment() {
  const id = document.getElementById("approve-id").value
  const m = members.find(x => x.id === id)
  
  // Extend Expiry by their plan months (Default 1 if trial)
  const months = (m.plan === "trial") ? 1 : parseInt(m.plan)
  m.plan = String(months) // They are no longer on trial
  
  let start = new Date(m.expiry > todayISO() ? m.expiry : todayISO())
  start.setMonth(start.getMonth() + months)
  m.expiry = start.toISOString().split("T")[0]
  
  m.status = "active"
  m.paymentProof = null // Free up localStorage space!
  
  saveMembers()
  hide("image-modal")
  toast(`✅ Payment Approved for ${m.name}! Expiry: ${m.expiry}`)
  renderMembers(); renderDashboard()
}

function rejectPayment() {
  const id = document.getElementById("approve-id").value
  const m = members.find(x => x.id === id)
  m.status = "active" // Back to whatever they were (likely expired)
  m.paymentProof = null
  saveMembers()
  hide("image-modal")
  toast(`❌ Payment Rejected for ${m.name}.`, "var(--red)")
  renderMembers(); renderDashboard()
}

// ═══════════════════════════════════════════════════════
//  QR SCANNER (HTML5-QRCode)
// ═══════════════════════════════════════════════════════
function openScanner() {
  closeSidebar(); show("scanner-modal"); hide("scan-result")
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false)
  html5QrcodeScanner.render(onScanSuccess, () => {})
}

function closeScanner() {
  hide("scanner-modal")
  if (html5QrcodeScanner) { html5QrcodeScanner.clear().catch(e=>{}); html5QrcodeScanner = null }
}

function onScanSuccess(decodedText) {
  if (html5QrcodeScanner) { html5QrcodeScanner.clear(); html5QrcodeScanner = null }
  document.getElementById("qr-reader").innerHTML = ""
  const m = members.find(x => x.id === decodedText)
  show("scan-result")
  
  if (!m) {
    setText("scan-name", "Unknown QR Code"); setText("scan-status", "Not found.")
    document.getElementById("scan-result").style.background = "#7f1d1d"; document.getElementById("scan-result").style.borderColor = "#ef4444"
    playSound(false)
  } else {
    setText("scan-name", m.name)
    if (m.expiry < todayISO() && m.status !== "pending") {
      document.getElementById("scan-result").style.background = "#7f1d1d"; document.getElementById("scan-result").style.borderColor = "#ef4444"
      setText("scan-status", "⚠️ Expired. Please Renew.")
      playSound(false)
    } else {
      m.visits = (m.visits || 0) + 1; saveMembers()
      document.getElementById("scan-result").style.background = "#064e3b"; document.getElementById("scan-result").style.borderColor = "#10b981"
      setText("scan-status", "✅ Attendance Logged!")
      playSound(true)
    }
  }
  setTimeout(closeScanner, 3000)
}

function playSound() { const a=document.getElementById("beep"); a.currentTime=0; a.play().catch(e=>{}) }

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
function saveGymName() { config.gymName = val("set-gymname"); saveConfig(); setText("sidebar-gymname", config.gymName); toast("🏢 Gym name saved!") }
function saveBankDetails() {
  config.bankDetails = document.getElementById("set-bank").value
  config.stripeLink  = document.getElementById("set-stripe").value
  saveConfig()
  toast("💳 Payment methods saved!")
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

function showErr(id, msg) { const el=document.getElementById(id); el.textContent=msg; el.classList.remove("hidden") }
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("open") }
function closeSidebar() { document.getElementById("sidebar").classList.remove("open") }

let tId; function toast(msg, bg = "var(--green)") {
  const el = document.getElementById("toast"); el.textContent = msg; el.style.background = bg
  el.style.color = bg === "var(--green)" ? "#000" : "#fff"; el.classList.add("show")
  clearTimeout(tId); tId = setTimeout(() => el.classList.remove("show"), 2500)
}

function addVisit(id) { const m=members.find(x=>x.id===id); if(!m)return; if(m.expiry<todayISO()){toast(`⚠️ Expired!`, "var(--red)"); return} m.visits=(m.visits||0)+1; saveMembers(); renderMembers(); toast(`📌 Logged!`, "var(--blue)")}
function downloadQR(){ const c=document.getElementById("member-qr"), a=document.createElement("a"); a.href=c.toDataURL("image/png"); a.download=`${document.getElementById("qr-id-text").textContent}-card.png`; a.click() }
function exportCSV(){ if(!members.length)return toast("No data"); const b=new Blob(["ID,Name,Expiry\n"+members.map(m=>`${m.id},${m.name},${m.expiry}`).join("\n")],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="members.csv"; a.click() }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js")
initApp()
