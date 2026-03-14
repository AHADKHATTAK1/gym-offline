/* ═══════════════════════════════════════════════════════
   GYM MANAGER PRO V4 – app.js
   Features: Offline PWA | QR Scanner | Trial | Payments | Diet & Expenses
═══════════════════════════════════════════════════════ */

const KEY_CONFIG   = "gymConfigV3"
const KEY_MEMBERS  = "gymMembersV4"
const KEY_EXPENSES = "gymExpensesV4"
const KEY_SESSION  = "gymSessionV3"

let members = []
let expenses = []
let config  = {}
let revChart, attChart
let html5QrcodeScanner = null
let currentCheckoutId  = null

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  config   = JSON.parse(localStorage.getItem(KEY_CONFIG)  || "null")
  expenses = JSON.parse(localStorage.getItem(KEY_EXPENSES)|| "[]")
  members  = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "null")

  // Migrate old data
  if (!members) {
    members = JSON.parse(localStorage.getItem("gymMembersV3") || localStorage.getItem("gymMembersV2") || "[]")
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
  const gymName = val("setup-gymname"), user = val("setup-user"), pass = val("setup-pass")
  if (!gymName || !user || !pass) return showErr("setup-error", "All fields required.")
  if (pass !== val("setup-pass2")) return showErr("setup-error", "Passwords do not match.")
  
  config = { gymName, user, pass, bankDetails: "", stripeLink: "" }
  saveConfig(); sessionStorage.setItem(KEY_SESSION, "ok"); launchApp()
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
  setText("sidebar-gymname", gn); setText("topbar-username", config.user); setText("topbar-avatar", config.user[0].toUpperCase())
  document.getElementById("set-gymname").value = gn
  document.getElementById("set-bank").value = config.bankDetails || ""
  document.getElementById("set-stripe").value = config.stripeLink || ""
  document.getElementById("exp-date").value = todayISO()
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
  if (page === "finances") renderFinances()
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const todayStr = todayISO()
  let act = 0, expCount = 0, tri = 0, rev = 0, pending = []

  // Check Members
  members.forEach(m => {
    if (m.status === "pending") pending.push(m)
    else if (m.plan === "trial" && m.expiry >= todayStr) tri++
    else if (m.expiry >= todayStr) { act++; if (m.fee) rev += (+m.fee) }
    else expCount++
  })

  // Check Expenses this month
  const thisMonth = todayStr.substring(0, 7) // "YYYY-MM"
  let expTotal = expenses.filter(e => e.date.startsWith(thisMonth)).reduce((s, e) => s + (+e.amount), 0)
  
  // Update Cards
  setText("stat-total", members.length)
  setText("stat-active", act)
  setText("stat-expired", expCount)
  
  // Net Profit Label
  const profit = rev - expTotal
  const pCard = document.getElementById("stat-profit")
  pCard.textContent = "PKR " + profit.toLocaleString()
  pCard.style.color = profit >= 0 ? "var(--green)" : "var(--red)"

  setText("dash-date", new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" }))

  // Approvals Box
  const appBox = document.getElementById("approvals-box"), appTab = document.getElementById("approvalsTable")
  if (pending.length > 0) {
    appBox.style.display = "block"
    appTab.innerHTML = pending.map(m => `<tr><td><strong>${esc(m.name)}</strong></td><td>${m.plan} Months<br><span style="font-size:0.8rem">PKR ${m.fee}</span></td><td><button class="tbtn tbtn-edit" onclick="viewScreenshot('${m.id}')">🧾 View</button></td><td><button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅ Approve</button></td></tr>`).join("")
  } else appBox.style.display = "none"

  drawCharts(rev, expTotal)
}

function drawCharts(currentMonthRev, currentMonthExp) {
  if (revChart) revChart.destroy(); if (attChart) attChart.destroy()
  Chart.defaults.color = "#94a3b8"; Chart.defaults.font.family = "Inter"

  const ctxRev = document.getElementById('revenueChart').getContext('2d')
  revChart = new Chart(ctxRev, {
    type: 'line', data: { labels: ["Jan","Feb","Mar","Apr","May","Jun"], datasets: [
      { label: 'Revenue', data: [12000, 19000, 15000, 22000, 30000, currentMonthRev], borderColor: '#10b981', backgroundColor: '#10b98122', fill: true, tension: 0.4 },
      { label: 'Expenses', data: [5000, 8000,  7000,  12000, 9000,  currentMonthExp], borderColor: '#ef4444', backgroundColor: 'transparent', fill: false, tension: 0.4, borderDash: [5, 5] }
    ]}, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:true, position:'bottom'}} }
  })

  let attTotal = members.reduce((s, m) => s + (m.visits||0), 0)
  const ctxAtt = document.getElementById('attendanceChart').getContext('2d')
  attChart = new Chart(ctxAtt, {
    type: 'bar', data: { labels: ["Jan","Feb","Mar","Apr","May","Jun"], datasets: [{ label: 'Visits', data: [50, 80, 120, 90, 150, attTotal], backgroundColor: '#3b82f6', borderRadius: 4 }]
    }, options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{display:false}} }
  })
}

// ═══════════════════════════════════════════════════════
//  MEMBERS & WHATSAPP
// ═══════════════════════════════════════════════════════
function renderMembers() {
  const search = val("search").toLowerCase(), filter = val("filterStatus"), today  = todayISO()

  let list = members.filter(m => {
    let stat = "expired"
    if (m.status === "pending") stat = "pending"
    else if (m.plan === "trial" && m.expiry >= today) stat = "trial"
    else if (m.expiry >= today) stat = "active"

    if (filter !== "all" && filter !== stat) return false
    if (search && !m.name.toLowerCase().includes(search) && !m.phone.includes(search) && !m.id.toLowerCase().includes(search)) return false
    return true
  })

  const tbody = document.getElementById("membersTable")
  if (!list.length) return tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">No members found</td></tr>`

  tbody.innerHTML = list.map(m => {
    let badge = "", actionBtn = "", isExp = m.expiry < today
    if (m.status === "pending") { badge = `<span class="badge pending">⏳ Pending</span>`; actionBtn = `<button class="tbtn tbtn-pay" onclick="approvePaymentDirect('${m.id}')">✅ Apprv</button>` } 
    else if (isExp) { badge = `<span class="badge expired">🔴 Expired</span>`; actionBtn = `<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">💳 Pay</button>` } 
    else if (m.plan === "trial") { badge = `<span class="badge trial">🟡 Trial</span>`; actionBtn = `<button class="tbtn tbtn-pay" onclick="openCheckout('${m.id}')">💳 Upg</button>` } 
    else { badge = `<span class="badge active">🟢 Active</span>`; actionBtn = "" }

    // WhatsApp Link formatting
    const waNum = parsePhoneToWA(m.phone)
    const waText = isExp 
      ? `Hi ${m.name}, your gym subscription at ${config.gymName||'the gym'} expired on ${m.expiry}. Please renew your membership to continue working out!`
      : `Hi ${m.name}, hope you are having a great workout week at ${config.gymName||'the gym'}!`
    
    const waHTML = waNum ? `<a href="https://wa.me/${waNum}?text=${encodeURIComponent(waText)}" target="_blank" class="wa-btn">💬 WA</a>` : ``

    return `<tr>
      <td style="font-size:0.75rem;color:var(--muted)">${m.id}</td>
      <td><strong>${esc(m.name)}</strong></td>
      <td><span style="font-size:0.8rem;color:var(--muted)">${esc(m.phone)}</span>${waHTML}</td>
      <td>${m.plan==="trial"?"Trial":m.plan+"m"}<br><span style="font-size:0.8rem">PKR ${(+m.fee).toLocaleString()}</span></td>
      <td style="font-weight:600;color:${isExp?'var(--red)':'var(--text)'}">${m.expiry}</td>
      <td><span style="font-weight:700;margin-right:6px">${m.visits||0}</span><button class="tbtn tbtn-attend" onclick="addVisit('${m.id}')">+1</button></td>
      <td>${actionBtn}<button class="tbtn tbtn-edit" onclick="openEditModal('${m.id}')">✏️</button><button class="tbtn tbtn-delete" onclick="removeMember('${m.id}')">🗑️</button></td>
    </tr>`
  }).join("")
}

function parsePhoneToWA(phone) {
  let p = phone.replace(/[^0-9]/g, '')
  if (p.startsWith("00")) p = p.substring(2)
  if (p.startsWith("0")) p = "92" + p.substring(1) // Default to Pakistan if starting with 0
  return p
}

// ═══════════════════════════════════════════════════════
//  CRUD & MODALS (DIET PLAN)
// ═══════════════════════════════════════════════════════
function openAddModal() {
  setText("modal-title", "➕ Add Member"); document.getElementById("m-edit-id").value = ""
  ;["name", "phone", "fee", "notes"].forEach(id => document.getElementById("m-"+id).value = "")
  document.getElementById("m-plan").value = "trial"
  document.getElementById("m-date").value = todayISO()
  handlePlanChange()
  hide("qr-section"); show("modal-overlay")
}

function openEditModal(id) {
  const m = members.find(x => x.id === id)
  setText("modal-title", "✏️ Edit Member"); document.getElementById("m-edit-id").value = m.id
  document.getElementById("m-name").value=m.name; document.getElementById("m-phone").value=m.phone; document.getElementById("m-fee").value=m.fee
  document.getElementById("m-plan").value=m.plan; document.getElementById("m-date").value=m.date; document.getElementById("m-expiry").value=m.expiry
  document.getElementById("m-notes").value = m.notes || ""
  
  show("qr-section"); setText("qr-id-text", m.id)
  if (window.innerWidth > 768) {
    document.getElementById("qr-section").style.display = "flex"
    new QRious({ element: document.getElementById('member-qr'), value: m.id, size: 140 })
  }
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
  const id=val("m-edit-id"), name=val("m-name"), phone=val("m-phone"), fee=val("m-fee"), plan=val("m-plan"), date=val("m-date"), exp=val("m-expiry"), notes=val("m-notes")
  if (!name || !phone || !fee) return toast("⚠️ Required fields!", "var(--red)")
  if (id) {
    const idx = members.findIndex(x => x.id === id)
    members[idx] = { ...members[idx], name, phone, fee, plan, date, expiry: exp, notes }
    toast("✏️ Updated!")
  } else {
    members.push({ id: "GYM-" + Math.floor(Math.random()*90000+10000), name, phone, fee, plan, date, expiry: exp, visits: 0, status: "active", notes })
    toast("✅ Member added!")
  }
  saveMembers(); closeAddModal(); renderMembers(); renderDashboard()
}

function removeMember(id) {
  if (!confirm("Delete permanent?")) return
  members = members.filter(x => x.id !== id); saveMembers(); renderMembers(); renderDashboard()
}

// Print Routine
function printRoutine() {
  const mName = val("m-name"), mNotes = val("m-notes")
  if (!mName || !mNotes) return toast("Add a name and routine first!", "var(--red)")
  
  const p = document.getElementById("print-container")
  p.innerHTML = `
    <div class="print-head">
      <div class="print-title">${config.gymName || "Gym Manager"}</div>
      <div class="print-meta">Member Diet & Workout Routine</div>
    </div>
    <div style="font-size:20px; font-weight:700; margin-bottom: 10px;">Name: ${mName}</div>
    <div class="print-notes">${mNotes}</div>
  `
  window.print()
}

// ═══════════════════════════════════════════════════════
//  FINANCES & EXPENSES
// ═══════════════════════════════════════════════════════
function renderFinances() {
  let total = 0
  const tbody = document.getElementById("expensesTable")
  if (!expenses.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted)">No expenses logged</td></tr>`
  } else {
    // Sort descending by date
    expenses.sort((a,b) => new Date(b.date) - new Date(a.date))
    tbody.innerHTML = expenses.map(e => {
      total += (+e.amount)
      return `<tr>
        <td style="font-size:0.8rem">${e.date}</td>
        <td><strong>${esc(e.title)}</strong></td>
        <td><span class="badge" style="background:var(--surface2)">${e.cat}</span></td>
        <td style="color:var(--red); font-weight:600">PKR ${(+e.amount).toLocaleString()}</td>
        <td><button class="tbtn tbtn-delete" onclick="removeExpense('${e.id}')">🗑️</button></td>
      </tr>`
    }).join("")
  }
  document.getElementById("total-exp-label").textContent = "PKR " + total.toLocaleString()
}

function addExpense() {
  const date = val("exp-date"), amount = val("exp-amount"), title = val("exp-title"), cat = val("exp-category")
  if (!date || !amount || !title) return toast("⚠️ Date, Amount, and Title required", "var(--red)")
  
  expenses.push({ id: "EXP-" + Date.now(), date, amount, title, cat })
  saveExpenses()
  
  // reset
  document.getElementById("exp-amount").value = ""
  document.getElementById("exp-title").value = ""
  
  renderFinances()
  toast("📉 Expense Logged!")
}

function removeExpense(id) {
  if (!confirm("Delete expense record?")) return
  expenses = expenses.filter(x => x.id !== id)
  saveExpenses()
  renderFinances()
}

// ═══════════════════════════════════════════════════════
//  CHECKOUT & APPROVALS
// ═══════════════════════════════════════════════════════
function openCheckout(id) {
  const m = members.find(x => x.id === id); if (!m) return
  currentCheckoutId = m.id
  hide("screen-app"); show("screen-checkout")
  setText("chk-member-name", m.name + " (" + m.phone + ")"); setText("chk-amount", "PKR " + (+m.fee).toLocaleString())
  setText("chk-bank-details", config.bankDetails || "Pay at desk.")
  document.getElementById("chk-screenshot").value = ""; showChkTab("local")
}

function cancelCheckout() { hide("screen-checkout"); show("screen-app"); currentCheckoutId = null }
function showChkTab(tab) {
  if (tab === "local") {
    show("chk-flow-local"); hide("chk-flow-card")
    document.getElementById("tab-local").style.background="var(--green)"; document.getElementById("tab-local").style.color="#000"
    document.getElementById("tab-card").style.background="var(--surface2)"; document.getElementById("tab-card").style.color="var(--text)"
  } else {
    hide("chk-flow-local"); show("chk-flow-card")
    document.getElementById("tab-card").style.background="var(--green)"; document.getElementById("tab-card").style.color="#000"
    document.getElementById("tab-local").style.background="var(--surface2)"; document.getElementById("tab-local").style.color="var(--text)"
  }
}

function submitScreenshot() {
  const fileInput = document.getElementById("chk-screenshot")
  if (!fileInput.files[0]) return alert("Select a screenshot.")
  const reader = new FileReader(); reader.onload = function(e) {
    const m = members.find(x => x.id === currentCheckoutId)
    m.status = "pending"; m.paymentProof = e.target.result
    saveMembers(); toast("📤 Submitted!", "var(--blue)"); cancelCheckout(); renderMembers(); renderDashboard()
  }
  reader.readAsDataURL(fileInput.files[0])
}

function goToStripe() { if(!config.stripeLink)return alert("Stripe link not set."); window.open(config.stripeLink, "_blank") }

function viewScreenshot(id) {
  const m = members.find(x => x.id === id); if (!m || !m.paymentProof) return toast("No image", "var(--red)")
  document.getElementById("view-screenshot").src = m.paymentProof; document.getElementById("approve-id").value = m.id; show("image-modal")
}

function approvePaymentDirect(id) { document.getElementById("approve-id").value = id; approvePayment() }
function approvePayment() {
  const m = members.find(x => x.id === document.getElementById("approve-id").value)
  const months = (m.plan === "trial") ? 1 : parseInt(m.plan)
  m.plan = String(months)
  let start = new Date(m.expiry > todayISO() ? m.expiry : todayISO()); start.setMonth(start.getMonth() + months); m.expiry = start.toISOString().split("T")[0]
  m.status = "active"; m.paymentProof = null; saveMembers(); hide("image-modal"); toast(`✅ Approved! Expiry: ${m.expiry}`); renderMembers(); renderDashboard()
}

function rejectPayment() {
  const m = members.find(x => x.id === document.getElementById("approve-id").value)
  m.status = "active"; m.paymentProof = null; saveMembers(); hide("image-modal"); toast(`❌ Rejected.`, "var(--red)"); renderMembers(); renderDashboard()
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
  hide("scanner-modal"); if (html5QrcodeScanner) { html5QrcodeScanner.clear().catch(e=>{}); html5QrcodeScanner = null }
}

function onScanSuccess(decodedText) {
  if(html5QrcodeScanner){html5QrcodeScanner.clear();html5QrcodeScanner=null}
  document.getElementById("qr-reader").innerHTML = ""; const m = members.find(x => x.id === decodedText); show("scan-result")
  if (!m) {
    setText("scan-name", "Unknown"); setText("scan-status", "Not found."); document.getElementById("scan-result").style.background = "#7f1d1d"; document.getElementById("scan-result").style.borderColor = "#ef4444"; playSound(false)
  } else {
    setText("scan-name", m.name)
    if (m.expiry < todayISO() && m.status !== "pending") {
      document.getElementById("scan-result").style.background = "#7f1d1d"; document.getElementById("scan-result").style.borderColor = "#ef4444"; setText("scan-status", "⚠️ Expired."); playSound(false)
    } else {
      m.visits = (m.visits||0)+1; saveMembers(); document.getElementById("scan-result").style.background = "#064e3b"; document.getElementById("scan-result").style.borderColor = "#10b981"; setText("scan-status", "✅ Logged!"); playSound(true)
    }
  }
  setTimeout(closeScanner, 3000)
}

function playSound() { const a=document.getElementById("beep"); a.currentTime=0; a.play().catch(e=>{}) }

// ═══════════════════════════════════════════════════════
//  SETTINGS & UTILS
// ═══════════════════════════════════════════════════════
function saveGymName() { config.gymName = val("set-gymname"); saveConfig(); setText("sidebar-gymname", config.gymName); toast("🏢 Gym name saved!") }
function saveBankDetails() { config.bankDetails = document.getElementById("set-bank").value; config.stripeLink = document.getElementById("set-stripe").value; saveConfig(); toast("💳 Settings saved!") }

function save() { saveMembers(); saveExpenses(); saveConfig() }
function saveMembers() { localStorage.setItem(KEY_MEMBERS, JSON.stringify(members)) }
function saveExpenses() { localStorage.setItem(KEY_EXPENSES, JSON.stringify(expenses)) }
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
function downloadQR(){ const c=document.getElementById("member-qr"), a=document.createElement("a"); a.href=c.toDataURL("image/png"); a.download=`QR.png`; a.click() }
function exportCSV(){ if(!members.length)return toast("No data"); const b=new Blob(["ID,Name,Phone,Expiry\n"+members.map(m=>`${m.id},${m.name},${m.phone},${m.expiry}`).join("\n")],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="members.csv"; a.click() }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js")
initApp()
