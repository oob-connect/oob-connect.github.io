/* ===========================================================================
   Classroom Chat — vanilla JS client
   No framework, no build step. Talks to Supabase (loaded from CDN) for auth,
   data, and realtime. Access rules live in the database (RLS); this file is
   just the UI.
   =========================================================================== */
(function () {
  "use strict";

  // --- Config / client -----------------------------------------------------
  var cfg = window.APP_CONFIG || {};
  var MESSAGE_SELECT = "*, author:profiles(display_name)";

  if (
    !cfg.SUPABASE_URL ||
    !cfg.SUPABASE_ANON_KEY ||
    cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") !== -1 ||
    cfg.SUPABASE_ANON_KEY.indexOf("PASTE_YOUR") !== -1 ||
    cfg.SUPABASE_ANON_KEY.indexOf("your-anon") !== -1
  ) {
    document.body.innerHTML =
      '<div style="max-width:560px;margin:80px auto;padding:26px;font-family:Nunito,sans-serif;' +
      'color:#f2eee2;background:#1f2a27;box-shadow:inset 0 0 0 1.5px rgba(242,238,226,0.22);' +
      'border-radius:16px;line-height:1.6">' +
      '<h1 style="margin-top:0;font-size:20px;font-family:Caveat,cursive;font-weight:700">Configuration needed</h1>' +
      "<p>Copy <code>config.example.js</code> to <code>config.js</code> and fill in your " +
      "Supabase project URL and anon key (Settings &rarr; API in the Supabase dashboard).</p></div>";
    return;
  }

  var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // --- Tiny DOM helpers ----------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function icons() { if (window.lucide) window.lucide.createIcons(); }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Give each person a stable "piece of chalk" colour.
  var CHALK = ["#f4d06a", "#f0937e", "#93d3a2", "#8ec6e6", "#e8a0c8", "#b8a6e6", "#7fd1c4", "#f0b56a"];
  function chalkColor(name) {
    var s = String(name || "?"), h = 0, i;
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return CHALK[h % CHALK.length];
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDay(iso) {
    var d = new Date(iso);
    var today = new Date();
    var yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }

  // --- App state -----------------------------------------------------------
  var state = {
    session: null,
    profile: null,
    rooms: [],
    activeRoomId: null,
    messages: [],
    roomsChannel: null,
    msgChannel: null,
  };

  // =========================================================================
  // AUTH
  // =========================================================================
  // Accountability: everyone must sign in with a school account. The database
  // enforces this too (see supabase/migrations/0002_restrict_domain.sql); an
  // existing admin on another domain is allowed through so you are never
  // locked out of your own instance.
  var ALLOWED_DOMAIN = "gemsed.com";
  function emailAllowed(email) {
    return new RegExp("@" + ALLOWED_DOMAIN.replace(/\./g, "\\.") + "$", "i").test(email || "");
  }
  var pendingAuthError = null;

  var authMode = "signin";

  function setAuthMode(mode) {
    authMode = mode;
    var isSignup = mode === "signup";
    $("auth-subtitle").textContent = isSignup ? "Create your account" : "Sign in to continue";
    $("name-field").hidden = !isSignup;
    $("auth-password").setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
    $("auth-submit").querySelector(".btn-label").textContent = isSignup ? "Create account" : "Sign in";
    $("switch-text").textContent = isSignup ? "Already have one?" : "No account yet?";
    $("auth-toggle").textContent = isSignup ? "Sign in" : "Sign up";
    hide($("auth-error")); hide($("auth-notice"));
  }

  function authError(msg) { var e = $("auth-error"); e.textContent = msg; show(e); }
  function authNotice(msg) { var n = $("auth-notice"); n.textContent = msg; show(n); }

  $("auth-toggle").addEventListener("click", function () {
    setAuthMode(authMode === "signin" ? "signup" : "signin");
  });

  // Sign in with a Microsoft (Entra ID) school account.
  $("ms-btn").addEventListener("click", function () {
    hide($("auth-error")); hide($("auth-notice"));
    client.auth
      .signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "openid email profile",
          redirectTo: location.origin + location.pathname,
        },
      })
      .then(function (res) { if (res.error) authError(res.error.message); })
      .catch(function (err) { authError(err.message || "Could not start Microsoft sign-in."); });
  });

  $("auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    hide($("auth-error")); hide($("auth-notice"));
    var email = $("auth-email").value.trim();
    var password = $("auth-password").value;
    var name = $("auth-name").value.trim();
    var btn = $("auth-submit");
    btn.disabled = true;

    var done = function () { btn.disabled = false; };

    // Block non-school emails up front (the database enforces this too).
    if (authMode === "signup" && !emailAllowed(email)) {
      authError("Sign up with your @" + ALLOWED_DOMAIN + " school account.");
      done();
      return;
    }

    if (authMode === "signup") {
      client.auth
        .signUp({
          email: email,
          password: password,
          options: { data: { display_name: name || email.split("@")[0] } },
        })
        .then(function (res) {
          if (res.error) { authError(res.error.message); return; }
          if (!res.data.session) {
            authNotice("Account created. Check your email to confirm, then sign in.");
            setAuthMode("signin");
          }
        })
        .catch(function (err) { authError(err.message || "Something went wrong."); })
        .finally(done);
    } else {
      client.auth
        .signInWithPassword({ email: email, password: password })
        .then(function (res) { if (res.error) authError(res.error.message); })
        .catch(function (err) { authError(err.message || "Something went wrong."); })
        .finally(done);
    }
  });

  $("signout-btn").addEventListener("click", function () {
    client.auth.signOut();
  });

  // =========================================================================
  // PROFILE
  // =========================================================================
  function loadProfile(userId) {
    return client
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(function (res) { return res.data; });
  }

  function renderMe() {
    var p = state.profile;
    var name = (p && p.display_name) || (state.session && state.session.user.email) || "—";
    $("me-name").textContent = name;
    var meAvatar = $("me-avatar");
    meAvatar.textContent = initials(name);
    meAvatar.style.background = chalkColor(name);
    var role = $("me-role");
    if (p && p.is_admin) { role.textContent = "admin"; role.classList.add("admin"); }
    else { role.textContent = "member"; role.classList.remove("admin"); }
    // Only an admin sees the "new room" control (DB also enforces this).
    $("new-room-btn").hidden = !(p && p.is_admin);
  }

  // =========================================================================
  // ROOMS
  // =========================================================================
  function loadRooms() {
    return client
      .from("rooms")
      .select("*")
      .order("created_at", { ascending: true })
      .then(function (res) {
        state.rooms = res.data || [];
        renderRooms();
      });
  }

  function renderRooms() {
    var list = $("room-list");
    list.innerHTML = "";
    $("rooms-empty").hidden = state.rooms.length > 0;

    var amAdmin = state.profile && state.profile.is_admin;

    state.rooms.forEach(function (room) {
      var li = document.createElement("li");
      li.className = "room-row";

      var btn = document.createElement("button");
      btn.className = "room-item" + (room.id === state.activeRoomId ? " active" : "");
      btn.innerHTML =
        '<span class="r-name">' + escapeHtml(room.name) + "</span>" +
        (room.topic ? '<span class="r-topic">' + escapeHtml(room.topic) + "</span>" : "");
      btn.addEventListener("click", function () { selectRoom(room.id); });
      li.appendChild(btn);

      // Admins get a delete control per room (DB also enforces admin-only).
      if (amAdmin) {
        var del = document.createElement("button");
        del.className = "room-del icon-btn";
        del.title = "Delete room";
        del.setAttribute("aria-label", "Delete room " + room.name);
        del.innerHTML = '<span data-lucide="trash-2"></span>';
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          deleteRoom(room);
        });
        li.appendChild(del);
      }

      list.appendChild(li);
    });

    icons(); // render any newly added trash icons
  }

  function deleteRoom(room) {
    var ok = window.confirm(
      "Delete “" + room.name + "”?\n\n" +
        "This removes the room and all of its messages for everyone. " +
        "This cannot be undone."
    );
    if (!ok) return;

    client
      .from("rooms")
      .delete()
      .eq("id", room.id)
      .then(function (res) {
        if (res.error) {
          alert(
            /row-level security/i.test(res.error.message || "")
              ? "Only an admin can delete rooms."
              : "Could not delete room: " + res.error.message
          );
          return;
        }
        // If the open room was the one removed, reset the main pane.
        if (state.activeRoomId === room.id) {
          state.activeRoomId = null;
          if (state.msgChannel) { client.removeChannel(state.msgChannel); state.msgChannel = null; }
          state.messages = [];
          $("message-list").innerHTML = "";
          $("room-name").textContent = "Select a room";
          $("room-topic").textContent = "";
          $("live-dot").classList.remove("on");
          show($("messages-placeholder"));
          hide($("composer"));
        }
        state.rooms = state.rooms.filter(function (r) { return r.id !== room.id; });
        renderRooms(); // realtime will also refresh for other clients
      });
  }

  function subscribeRooms() {
    if (state.roomsChannel) client.removeChannel(state.roomsChannel);
    state.roomsChannel = client
      .channel("rooms-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, function () {
        loadRooms();
      })
      .subscribe();
  }

  // Admin: open / close / submit the new-room form
  $("new-room-btn").addEventListener("click", function () {
    show($("new-room-form"));
    $("new-room-name").focus();
  });
  $("new-room-cancel").addEventListener("click", function () {
    hide($("new-room-form"));
    $("new-room-form").reset();
    hide($("new-room-error"));
  });
  $("new-room-form").addEventListener("submit", function (e) {
    e.preventDefault();
    hide($("new-room-error"));
    var name = $("new-room-name").value.trim();
    var topic = $("new-room-topic").value.trim();
    if (!name) return;

    client
      .from("rooms")
      .insert({ name: name, topic: topic || null, created_by: state.session.user.id })
      .select()
      .single()
      .then(function (res) {
        if (res.error) {
          var e2 = $("new-room-error");
          e2.textContent =
            res.error.message && /row-level security/i.test(res.error.message)
              ? "Only an admin can create rooms."
              : res.error.message || "Could not create room.";
          show(e2);
          return;
        }
        $("new-room-form").reset();
        hide($("new-room-form"));
        selectRoom(res.data.id); // realtime will also refresh the list
      });
  });

  // =========================================================================
  // MESSAGES
  // =========================================================================
  function selectRoom(roomId) {
    if (state.activeRoomId === roomId) return;
    state.activeRoomId = roomId;
    renderRooms();

    var room = state.rooms.filter(function (r) { return r.id === roomId; })[0];
    $("room-name").textContent = room ? room.name : "Room";
    $("room-topic").textContent = room && room.topic ? room.topic : "";
    hide($("messages-placeholder"));
    show($("composer"));

    loadMessages(roomId);
    subscribeMessages(roomId);
  }

  function loadMessages(roomId) {
    $("message-list").innerHTML = "";
    client
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(function (res) {
        if (state.activeRoomId !== roomId) return;
        state.messages = res.data || [];
        renderMessages();
        scrollToBottom();
      });
  }

  function subscribeMessages(roomId) {
    if (state.msgChannel) client.removeChannel(state.msgChannel);
    var live = $("live-dot");
    live.classList.remove("on");

    state.msgChannel = client
      .channel("messages:" + roomId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq." + roomId },
        function (payload) {
          var row = payload.new;
          if (state.messages.some(function (m) { return m.id === row.id; })) return;
          // Fetch the joined author display name for the new row.
          client
            .from("messages")
            .select(MESSAGE_SELECT)
            .eq("id", row.id)
            .maybeSingle()
            .then(function (res) {
              if (!res.data || state.activeRoomId !== roomId) return;
              if (state.messages.some(function (m) { return m.id === res.data.id; })) return;
              state.messages.push(res.data);
              renderMessages();
              scrollToBottom();
            });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: "room_id=eq." + roomId },
        function (payload) {
          state.messages = state.messages.filter(function (m) { return m.id !== payload.old.id; });
          renderMessages();
        }
      )
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") live.classList.add("on");
      });
  }

  function renderMessages() {
    var listEl = $("message-list");
    listEl.innerHTML = "";
    var lastDay = null;
    var myId = state.session && state.session.user.id;
    var amAdmin = state.profile && state.profile.is_admin;

    state.messages.forEach(function (m) {
      var day = fmtDay(m.created_at);
      if (day !== lastDay) {
        lastDay = day;
        var div = document.createElement("li");
        div.className = "day-divider";
        div.textContent = day;
        listEl.appendChild(div);
      }

      var name = (m.author && m.author.display_name) || "Unknown";
      var li = document.createElement("li");
      li.className = "msg";
      var canDelete = m.author_id === myId || amAdmin;
      var color = chalkColor(name);

      li.innerHTML =
        '<span class="avatar" style="background:' + color + '">' + escapeHtml(initials(name)) + "</span>" +
        '<div class="msg-body">' +
          '<div class="msg-meta">' +
            '<span class="msg-author" style="color:' + color + '">' + escapeHtml(name) +
              (m.author_id === myId ? '<span class="tag">you</span>' : "") +
            "</span>" +
            '<span class="msg-time">' + escapeHtml(fmtTime(m.created_at)) + "</span>" +
            (canDelete ? '<button class="msg-del" title="Delete">delete</button>' : "") +
          "</div>" +
          '<div class="msg-text">' + escapeHtml(m.body) + "</div>" +
        "</div>";

      if (canDelete) {
        li.querySelector(".msg-del").addEventListener("click", function () {
          client.from("messages").delete().eq("id", m.id).then(function (res) {
            if (!res.error) {
              state.messages = state.messages.filter(function (x) { return x.id !== m.id; });
              renderMessages();
            }
          });
        });
      }
      listEl.appendChild(li);
    });
  }

  function scrollToBottom() {
    var s = $("message-scroll");
    s.scrollTop = s.scrollHeight;
  }

  // Composer: send on Enter (Shift+Enter = newline), auto-grow
  var input = $("composer-input");
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });

  $("composer").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = input.value.trim();
    if (!body || !state.activeRoomId) return;
    input.value = "";
    input.style.height = "auto";

    client
      .from("messages")
      .insert({
        room_id: state.activeRoomId,
        author_id: state.session.user.id,
        body: body,
      })
      .then(function (res) {
        if (res.error) {
          // Put the text back so nothing is lost.
          input.value = body;
          alert("Could not send: " + res.error.message);
        }
      });
  });

  // =========================================================================
  // SESSION WIRING
  // =========================================================================
  function enterApp() {
    hide($("auth-view"));
    show($("app-view"));
    renderMe();
    subscribeRooms();
    loadRooms();
    icons();
  }

  function enterAuth() {
    // Tear down any live subscriptions.
    if (state.msgChannel) { client.removeChannel(state.msgChannel); state.msgChannel = null; }
    if (state.roomsChannel) { client.removeChannel(state.roomsChannel); state.roomsChannel = null; }
    state.activeRoomId = null;
    state.messages = [];
    hide($("app-view"));
    show($("auth-view"));
    setAuthMode("signin");
    if (pendingAuthError) { authError(pendingAuthError); pendingAuthError = null; }
    icons();
  }

  function onSession(session) {
    state.session = session;
    if (!session) { state.profile = null; enterAuth(); return; }

    var email = session.user.email || "";

    loadProfile(session.user.id).then(function (profile) {
      // Gate: only school accounts (or an existing admin) may enter.
      if (!emailAllowed(email) && !(profile && profile.is_admin)) {
        pendingAuthError =
          "That account isn’t allowed. Sign in with your @" + ALLOWED_DOMAIN + " school account.";
        client.auth.signOut(); // -> onSession(null) -> enterAuth shows the message
        return;
      }

      if (!profile) {
        // Profile row is created by a DB trigger; retry once after a beat.
        setTimeout(function () {
          loadProfile(session.user.id).then(function (p2) {
            state.profile = p2 || { display_name: session.user.email, is_admin: false };
            renderMe();
          });
        }, 1200);
        state.profile = { display_name: session.user.email, is_admin: false };
      } else {
        state.profile = profile;
      }
      enterApp();
    });
  }

  // Boot
  client.auth.getSession().then(function (res) { onSession(res.data.session); });
  client.auth.onAuthStateChange(function (_evt, session) {
    // Only fully re-wire when the signed-in user actually changes.
    var prevId = state.session && state.session.user.id;
    var nextId = session && session.user.id;
    if (prevId !== nextId) onSession(session);
    else state.session = session;
  });

  icons();
})();
