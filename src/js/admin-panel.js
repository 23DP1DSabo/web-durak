const dialog = document.querySelector("#admin-users-dialog");
const openButton = document.querySelector("#admin-users-open");
const closeButton = document.querySelector("#admin-users-close");
const randomBanButton = document.querySelector("#admin-random-ban");
const status = document.querySelector("#admin-users-status");
const userList = document.querySelector("#admin-users-list");
let loading = false;
let currentUsers = [];
const banDurations = [
  ["10s", "10 sekundes"],
  ["10m", "10 minūtes"],
  ["12h", "12 stundas"],
  ["24h", "24 stundas"],
  ["7d", "7 dienas"],
  ["30d", "30 dienas"],
  ["178d", "178 dienas"],
  ["356d", "356 dienas"],
  ["712d", "712 dienas"],
  ["permanent", "Wallahi"],
];

function addCell(row, content, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.append(content);
  row.append(cell);
  return cell;
}

function renderUsers(users) {
  userList.replaceChildren();

  for (const user of users) {
    const row = document.createElement("tr");
    const avatarCell = document.createElement("td");
    const avatar = document.createElement("span");
    avatar.className = "admin-user-avatar";

    if (typeof user.avatar === "string" && user.avatar.trim()) {
      try {
        const url = new URL(user.avatar, window.location.href);
        if (["http:", "https:"].includes(url.protocol)) {
          const image = document.createElement("img");
          image.src = url.href;
          image.alt = "";
          avatar.append(image);
        }
      } catch {
        // Fall back to the user's initials when the avatar URL is invalid.
      }
    }

    if (!avatar.childElementCount) {
      avatar.textContent = user.username.slice(0, 1).toLocaleUpperCase();
    }
    avatarCell.append(avatar);
    row.append(avatarCell);
    addCell(row, document.createTextNode(user.username));

    const online = document.createElement("span");
    online.className = user.isOnline ? "admin-user-online" : "admin-user-offline";
    online.textContent = user.isOnline ? "Tiešsaistē" : "Bezsaistē";
    addCell(row, online);

    const accountStatus = document.createElement("span");
    if (user.status === "ACTIVE") {
      accountStatus.textContent = "Aktīvs";
    } else if (user.banExpiresAt) {
      accountStatus.textContent = `Bloķēts līdz ${new Date(user.banExpiresAt).toLocaleString()}`;
    } else {
      accountStatus.textContent = "Bloķēts pastāvīgi";
    }
    addCell(row, accountStatus);

    const lastLogin = user.lastLoginAt
      ? new Date(user.lastLoginAt).toLocaleString()
      : "Nav pieslēdzies";
    addCell(row, document.createTextNode(lastLogin), "admin-user-last-login");

    const actions = document.createElement("div");
    actions.className = "admin-user-actions";
    const duration = document.createElement("select");
    duration.className = "admin-ban-duration";
    duration.setAttribute("aria-label", `Bloķēšanas ilgums lietotājam ${user.username}`);
    for (const [value, label] of banDurations) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      duration.append(option);
    }

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = user.status === "BANNED"
      ? "admin-user-unban"
      : "admin-user-ban";
    actionButton.disabled = user.role === "ADMIN";
    if (user.role === "ADMIN") {
      actionButton.textContent = "Administrators";
    } else if (user.status === "BANNED") {
      actionButton.textContent = "Atbloķēt";
      actionButton.addEventListener("click", () => updateBan(user));
    } else {
      actionButton.classList.add("admin-stamp-button");
      const stamp = document.createElement("img");
      stamp.className = "admin-ban-stamp";
      stamp.src = "../images/banned-stamp-2-3.png";
      stamp.alt = "";
      actionButton.setAttribute("aria-label", `Bloķēt ${user.username}`);
      actionButton.append(stamp);
      actionButton.addEventListener("click", () => updateBan(user, duration.value));
    }
    actions.append(duration, actionButton);
    addCell(row, actions, "admin-user-actions-cell");
    userList.append(row);
  }
}

async function updateBan(user, duration) {
  const isBanned = user.status === "BANNED";
  const action = isBanned ? "unban" : "ban";
  const button = [...userList.querySelectorAll("tr")].find((row) =>
    row.children[1]?.textContent === user.username
  )?.querySelector("button");
  if (button) button.disabled = true;
  status.textContent = isBanned
    ? `Atbloķē ${user.username}...`
    : `Bloķē ${user.username}...`;

  try {
    const response = await fetch(
      `/api/admin/users/${encodeURIComponent(user.id)}/${action}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(isBanned ? {} : { "Content-Type": "application/json" }),
        },
        ...(!isBanned ? { body: JSON.stringify({ duration }) } : {}),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Neizdevās mainīt konta statusu.");
    await loadUsers();
    return true;
  } catch (error) {
    status.textContent = error.message || "Neizdevās mainīt konta statusu.";
    if (button) button.disabled = false;
    return false;
  }
}

randomBanButton.addEventListener("click", async () => {
  const eligibleUsers = currentUsers.filter(
    (user) => user.role !== "ADMIN" && user.status === "ACTIVE",
  );
  if (!eligibleUsers.length) {
    status.textContent = "Nav aktīvu lietotāju, kurus varētu bloķēt.";
    return;
  }

  const user = eligibleUsers[Math.floor(Math.random() * eligibleUsers.length)];
  const [duration, label] = banDurations[Math.floor(Math.random() * banDurations.length)];
  randomBanButton.disabled = true;
  status.textContent = `Nejauši izvēlēts: ${user.username} — ${label}.`;
  try {
    if (await updateBan(user, duration)) {
      status.textContent = `Nejauši bloķēts: ${user.username} — ${label}.`;
    }
  } finally {
    randomBanButton.disabled = false;
  }
});

async function loadUsers() {
  if (loading) return;
  loading = true;
  currentUsers = [];
  status.textContent = "Ielādē lietotājus...";
  userList.replaceChildren();

  try {
    const response = await fetch("/api/admin/users", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Neizdevās ielādēt lietotājus.");
    }

    currentUsers = result.users;
    renderUsers(currentUsers);
    status.textContent = currentUsers.length
      ? `Lietotāju skaits: ${currentUsers.length}`
      : "Lietotāju nav.";
  } catch (error) {
    status.textContent = error.message || "Neizdevās ielādēt lietotājus.";
  } finally {
    loading = false;
  }
}

openButton.addEventListener("click", () => {
  dialog.showModal();
  loadUsers();
});

closeButton.addEventListener("click", () => dialog.close());
