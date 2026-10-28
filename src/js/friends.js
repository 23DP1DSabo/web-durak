import { renderAvatar } from "./avatar.js";

const searchForm = document.querySelector("#friend-search-form");
const usernameInput = document.querySelector("#friend-username");
const searchResults = document.querySelector("#friend-search-results");
const searchMessage = document.querySelector("#friend-search-message");
const friendsList = document.querySelector("#friends-list");
const requestsList = document.querySelector("#friend-requests-list");
const sentList = document.querySelector("#sent-requests-list");
const friendsEmpty = document.querySelector("#friends-empty");
const requestsEmpty = document.querySelector("#requests-empty");
const sentEmpty = document.querySelector("#sent-empty");
const pageMessage = document.querySelector("#friends-page-message");

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Kļūda (${response.status})`);
    }

    return data;
}

function makeButton(label, action, id, className = "btn") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", async () => {
        button.disabled = true;
        try {
            await action(id);
            await loadFriends();
        } catch (error) {
            pageMessage.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    return button;
}

function addUserItem(list, user, buttons = [], className = "") {
    const item = document.createElement("li");
    item.className = `friend-action-row ${className}`.trim();
    const name = document.createElement("span");

    name.textContent = user.username;
    const identity = document.createElement("span");
    identity.className = "friend-identity";
    const avatar = document.createElement("span");
    renderAvatar(avatar, user);
    identity.append(avatar, name);
    item.append(identity);

    if (buttons.length) {
        const actions = document.createElement("div");
        actions.className = "friend-row-actions";
        actions.append(...buttons);
        item.append(actions);
    }

    list.append(item);
}

async function searchUsers(username) {
    searchMessage.textContent = "Meklē...";
    searchResults.replaceChildren();

    try {
        const data = await api(
            `/api/friends/search?username=${encodeURIComponent(username)}`
        );

        if (!data.users?.length) {
            searchMessage.textContent = "Spēlētājs nav atrasts.";
            return;
        }

        searchMessage.textContent = "Meklēšanas rezultāti:";

        for (const user of data.users) {
            const button = makeButton(
                "Uzaicināt",
                sendRequest,
                user.id,
                "btn btn-primary"
            );

            if (user.friendshipStatus) {
                button.disabled = true;
                button.textContent = ({
                    PENDING: "Uzaicinājums nosūtīts",
                    ACCEPTED: "Jau draugi",
                })[user.friendshipStatus] || "Uzaicinājums jau pastāv";
            }

            addUserItem(searchResults, user, [button]);
        }
    } catch (error) {
        searchMessage.textContent = error.message;
    }
}

async function sendRequest(userId) {
    await api("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ recipientId: userId }),
    });

    pageMessage.textContent = "Draudzības uzaicinājums nosūtīts!";
}

async function removeFriend(friend) {
    if (!confirm(`Vai tiešām noņemt "${friend.username}" no draugiem?`)) return;

    await api(`/api/friends/${encodeURIComponent(friend.id)}`, {
        method: "DELETE",
    });
    pageMessage.textContent = `${friend.username} noņemts no draugiem.`;
}

async function respondToRequest(requestId, decision) {
    await api(`/api/friends/requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        body: JSON.stringify({ decision }),
    });

    pageMessage.textContent = decision === "accept"
        ? "Uzaicinājums pieņemts!"
        : "Uzaicinājums noraidīts.";
}

async function loadFriends() {
    try {
        const data = await api("/api/friends");

        friendsList.replaceChildren();
        requestsList.replaceChildren();
        sentList.replaceChildren();

        for (const friend of data.friends || []) {
            const removeButton = makeButton(
                "Noņemt",
                () => removeFriend(friend),
                friend.id,
                "btn friend-remove-button",
            );
            removeButton.setAttribute("aria-label", `Noņemt ${friend.username} no draugiem`);
            addUserItem(friendsList, friend, [removeButton], "friend-list-item");
        }

        for (const request of data.incoming || []) {
            addUserItem(requestsList, request.sender, [
                makeButton("Pieņemt", id => respondToRequest(id, "accept"), request.id, "btn btn-primary"),
                makeButton("Noraidīt", id => respondToRequest(id, "reject"), request.id),
            ]);
        }

        for (const request of data.outgoing || []) {
            addUserItem(sentList, request.recipient);
        }

        friendsEmpty.hidden = Boolean(data.friends?.length);
        requestsEmpty.hidden = Boolean(data.incoming?.length);
        sentEmpty.hidden = Boolean(data.outgoing?.length);
    } catch (error) {
        pageMessage.textContent = error.message;

        if (error.message.includes("401")) {
            pageMessage.textContent = "Lai izmantotu draugu funkciju, vispirms piesakies.";
        }
    }
}

searchForm.addEventListener("submit", async event => {
    event.preventDefault();

    const username = usernameInput.value.trim();

    if (username.length < 1) {
        searchMessage.textContent = "Ievadi lietotājvārdu.";
        return;
    }

    await searchUsers(username);
});

loadFriends();
