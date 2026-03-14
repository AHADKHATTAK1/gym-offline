let members = JSON.parse(localStorage.getItem("gymMembers")) || []

function save() {
  localStorage.setItem("gymMembers", JSON.stringify(members))
}

function addMember() {
  let name = document.getElementById("name").value
  let phone = document.getElementById("phone").value
  let fee = document.getElementById("fee").value

  if (!name || !phone || !fee) return alert("Please fill all fields")

  members.push({
    name,
    phone,
    fee,
    paid: false,
    attendance: 0
  })

  document.getElementById("name").value = ""
  document.getElementById("phone").value = ""
  document.getElementById("fee").value = ""

  save()
  loadMembers()
}

function pay(index) {
  members[index].paid = true
  save()
  loadMembers()
}

function attend(index) {
  members[index].attendance++
  save()
  loadMembers()
}

function remove(index) {
  if (confirm("Delete this member?")) {
    members.splice(index, 1)
    save()
    loadMembers()
  }
}

function loadMembers() {
  let search = document.getElementById("search").value.toLowerCase()
  let html = ""

  members.forEach((m, i) => {
    if (m.name.toLowerCase().includes(search)) {
      html += `
        <tr>
          <td>${m.name}</td>
          <td>${m.phone}</td>
          <td>${m.fee}</td>
          <td>
            ${m.paid ? "✅ Paid" : `<button onclick="pay(${i})">Pay</button>`}
          </td>
          <td>
            ${m.attendance}
            <button onclick="attend(${i})">+</button>
          </td>
          <td>
            <button onclick="remove(${i})" style="background:#ef4444">Delete</button>
          </td>
        </tr>
      `
    }
  })

  document.getElementById("members").innerHTML = html || "<tr><td colspan='6'>No members found</td></tr>"
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js")
    .then(() => console.log("Service Worker registered"))
    .catch(err => console.error("SW error:", err))
}

loadMembers()
