// Runs in the botc.app page itself (MAIN world) so it can read the app's Vuex store.
// It never changes game state: it only subscribes to mutations and reads state.
// Finished games are sent to the extension via window.postMessage (see bridge.js).
(() => {
  if (window.__botcTracker) return;

  const SCHEMA_VERSION = 1;
  const MSG_FLAG = '__botcTracker';
  const EVIL_TEAMS = ['minion', 'demon'];
  const GOOD_TEAMS = ['townsfolk', 'outsider'];
  const SAVE_KEY = 'botcTracker.current.v2'; // v2: earlier versions saved games that ended before joining

  const emit = (type, payload) => window.postMessage({ [MSG_FLAG]: true, dir: 'out', type, payload }, location.origin);
  const log = (...args) => console.debug('[Clockwise]', ...args);

  function findStore() {
    const el = document.querySelector('#main');
    const app = el && el.__vue_app__;
    return app && app.config && app.config.globalProperties && app.config.globalProperties.$store;
  }

  function attach(store) {
    const S = store.state;
    let current = restore();
    let activeNomination = null;
    let prevDead = [];
    let finalizeTimer = null;
    let voidTimer = null;
    let playersTimer = null;

    // ---------- helpers ----------
    const roleIdOf = (r) => (r && typeof r === 'object' ? r.id : r) || null;

    function roleInfo(id) {
      if (!id) return { id: null, name: null, team: null };
      const r = (S.roles && S.roles.get && S.roles.get(id)) || (S.rolesAvailable && S.rolesAvailable.get && S.rolesAvailable.get(id)) || {};
      return { id, name: r.name || id, team: r.team || null };
    }

    // Where a reminder token came from: a character, a Fabled, or the storyteller's own note.
    // The exact image botc.app shows for a character (or reminder source), via its own helper.
    // `alignment` picks the good/evil artwork, e.g. a red Washerwoman for an evil one.
    function iconUrl(roleId, alignment) {
      if (!roleId) return null;
      try {
        const role = (S.roles && S.roles.get && S.roles.get(roleId)) || roleId;
        const a = alignment === 'evil' ? 'e' : alignment === 'good' ? 'g' : '';
        return store.getters.roleIconURL(role, a) || null;
      } catch { return null; }
    }

    // The background the game was shown on: the storyteller's theme, or a custom image.
    function backgroundInfo() {
      const ed = S.edition || {};
      const info = { theme: S.grimoire ? S.grimoire.theme : 0, edition: ed.isOfficial ? ed.id : 'custom', url: null };
      try {
        const els = [document.getElementById('grimoire'), ...document.querySelectorAll('#grimoire [style*="background-image"], #app [style*="background-image"]')].filter(Boolean);
        for (const el of els) {
          const m = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage || '');
          if (m && /background|^https?:/.test(m[1]) && !/\/icons\//.test(m[1])) { info.url = new URL(m[1], location.href).href; break; }
        }
      } catch {}
      return info;
    }

    function reminderSource(role) {
      if (!role || role === 'custom') return null;
      if (role === 'good' || role === 'evil') return role === 'good' ? 'Good' : 'Evil';
      const r = S.roles && S.roles.get && S.roles.get(role);
      if (r && r.name) return r.name;
      const a = S.rolesAvailable && S.rolesAvailable.get && S.rolesAvailable.get(role);
      return (a && a.name) || npcName(role);
    }

    // The storyteller's reminder tokens, dead votes and demon bluffs as shown at the end. Players
    // usually only see these once the storyteller reveals the grimoire, so keep everything seen from
    // the end of the game through the reveal (later resets can't wipe it).
    // Reminder tokens only come from the storyteller's grimoire. In a player's browser, the tokens already on the
    // board when the game ends are the player's own notes (the storyteller's arrive with the reveal, after the
    // end), so those are noted the first time and left out from then on.
    const tokenKey = (r) => r.id || `${r.role}:${r.name}`;
    function captureGrimoire() {
      current.reminders = current.reminders || {};
      current.voteless = current.voteless || {};
      if (!hasGrimoireAccess() && !current.ownNotes) {
        current.ownNotes = S.players.players.flatMap((p) => (p.reminders || []).filter((r) => r && r.name).map(tokenKey));
      }
      const own = new Set(hasGrimoireAccess() ? [] : current.ownNotes);
      S.players.players.forEach((p, i) => {
        const seat = String(i + 1);
        const bag = (current.reminders[seat] = current.reminders[seat] || {});
        (p.reminders || []).forEach((r) => {
          if (!r || !r.name || own.has(tokenKey(r))) return;
          bag[tokenKey(r)] = { role: r.role || null, name: r.name };
        });
        if (Array.isArray(p.status) && p.status.includes('voteless')) current.voteless[seat] = true;
      });
      const bluffs = (S.players.bluffs || []).filter((b) => b && b.id).map((b) => b.id);
      if (bluffs.length) current.bluffs = bluffs;
    }

    function npcName(id) {
      const n = S.npcs && S.npcs.get && S.npcs.get(id);
      return (n && n.name) || id;
    }

    function username(userId) {
      if (!userId) return null;
      const u = S.session.users && S.session.users.get && S.session.users.get(userId);
      if (u && u.username) return u.username;
      if (S.user.user && S.user.user.id === userId && S.user.user.username) return S.user.user.username;
      return (current && current.names && current.names[userId]) || null;
    }

    function alignmentOf(raw, team) {
      if (raw === 'e' || raw === 'evil') return 'evil';
      if (raw === 'g' || raw === 'good') return 'good';
      if (EVIL_TEAMS.includes(team)) return 'evil';
      if (GOOD_TEAMS.includes(team)) return 'good';
      return null;
    }

    const isDead = (p) => !!(p && Array.isArray(p.status) && p.status.includes('dead'));
    const hasGrimoireAccess = () => { try { return !!store.getters['user/hasGrimoireAccess']; } catch { return false; } };

    function persist() {
      try {
        if (current) sessionStorage.setItem(SAVE_KEY, JSON.stringify(current));
        else sessionStorage.removeItem(SAVE_KEY);
      } catch {}
    }

    function restore() {
      try { return JSON.parse(sessionStorage.getItem(SAVE_KEY)) || null; } catch { return null; }
    }

    function status() {
      const g = S.game;
      emit('status', {
        attached: true,
        room: S.session.sessionId || null,
        connected: !!S.session.isConnected,
        loggedIn: !!(S.user.user && S.user.user.id),
        inGame: !!(current && !current.saved && !current.alreadyOver && S.game.isRunning),
        gameId: current ? current.id : null,
        phase: g.phase,
        players: S.players.players.length,
        nominations: current ? current.nominations.length : 0,
        at: Date.now(),
      });
    }

    // ---------- game lifecycle ----------
    function startKeyOf(start) {
      return String(start.time || start.id);
    }

    function newGame(start) {
      const room = S.session.sessionId || 'local';
      const key = startKeyOf(start);
      current = {
        key,
        id: `${room}:${key}`,
        room,
        startedAt: start.time || Date.now(),
        nominations: [],
        deaths: [],
        startingRoles: {},
        seatIds: [],
        stIds: [],
        names: {},
        saved: false,
        // Phase when we first saw this game: 0 = from the start, higher = joined mid-game.
        joinedAtPhase: S.game.phase,
        // botc.app sends a room's last game when you join, even if it finished before you
        // arrived. Those games weren't watched here, so they're never saved.
        alreadyOver: S.game.history.some((h) => h.type === 'end'),
      };
      prevDead = S.players.players.map(isDead);
      // Joined mid-game: we can't know when earlier deaths happened.
      prevDead.forEach((dead, i) => { if (dead) current.deaths.push({ seat: i + 1, userId: S.players.players[i].id || null, phase: null }); });
      log(current.alreadyOver ? 'ignoring game that ended before joining' : 'tracking game', current.id);
      persist();
    }

    function snapshotStartingRoles() {
      if (!current) return;
      const me = S.user.user && S.user.user.id;
      const all = hasGrimoireAccess();
      S.players.players.forEach((p, i) => {
        const seat = String(i + 1);
        if (current.startingRoles[seat]) return;
        const id = roleIdOf(p.role);
        if (id && (all || p.id === me)) current.startingRoles[seat] = id;
      });
    }

    // Remember who sat where and who storytold while the game runs, so people leaving
    // their seat (or the storyteller stepping out) after the reveal can't erase them.
    function remember() {
      if (!current || current.saved || current.frozen) return;
      current.seatIds = current.seatIds || [];
      current.stIds = current.stIds || [];
      current.names = current.names || {};
      S.players.players.forEach((p, i) => { if (p.id) current.seatIds[i] = p.id; });
      current.seatIds.length = S.players.players.length;
      S.players.storytellers.forEach((st) => { if (st.id && !current.stIds.includes(st.id)) current.stIds.push(st.id); });
      [...current.seatIds, ...current.stIds].forEach((id) => {
        const u = id && S.session.users && S.session.users.get && S.session.users.get(id);
        if (u && u.username) current.names[id] = u.username;
      });
    }

    function onHistory() {
      const { history } = S.game;
      const start = history.find((h) => h.type === 'start');
      if (!start) return; // cleared or not started; keep any saved game as-is

      if (!current || current.key !== startKeyOf(start)) newGame(start);
      const hasEnd = history.some((h) => h.type === 'end');
      if (current.alreadyOver) {
        if (hasEnd) { persist(); status(); return; }
        // The storyteller cancelled the reveal and play continues: from here on we're watching it live.
        current.alreadyOver = false;
        current.joinedAtPhase = S.game.phase;
      }
      if (S.game.phase <= 2) snapshotStartingRoles();
      if (!history.some((h) => h.type === 'end')) remember();

      const end = [...history].reverse().find((h) => h.type === 'end');
      if (end) {
        clearTimeout(voidTimer);
        scheduleFinalize(0);
      } else if (current.saved) {
        // Storyteller cancelled the reveal (or is re-ending). Void unless an end reappears.
        clearTimeout(voidTimer);
        voidTimer = setTimeout(() => {
          if (!S.game.history.some((h) => h.type === 'end') && current && current.saved) {
            emit('game:void', { id: current.id });
            current.saved = false;
            persist();
            log('game voided', current.id);
          }
        }, 8000);
      }
      persist();
      status();
    }

    function scheduleFinalize(delay) {
      clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(finalize, delay);
    }

    function finalize() {
      if (!current || current.alreadyOver) return;
      const end = [...S.game.history].reverse().find((h) => h.type === 'end');
      if (!end) return;
      flushNomination();
      captureGrimoire();
      const record = buildRecord(end);
      // Lock in identities at the first save; later re-saves only refresh roles/alignments.
      if (!current.frozen) {
        current.frozen = { seatIds: record.players.map((p) => [p.seat, p.userId]), stIds: record.storytellers.map((st) => st.userId) };
      }
      current.saved = true;
      persist();
      emit('game:upsert', record);
      log('saved game', record.id, record);
      status();
    }

    function buildRecord(end) {
      const data = end.data || {};
      const isEvilWin = !!data.isEvilWin;
      const live = S.players.players;
      const endPlayers = Array.isArray(data.players) && data.players.length ? data.players : live.map((p) => ({ role: p.role, alignment: p.alignment, status: p.status }));
      const phase = S.game.phase;
      const frozenSeat = current.frozen ? new Map(current.frozen.seatIds) : null;
      const seatId = (i) => (frozenSeat ? frozenSeat.get(i + 1) || null : (live[i] && live[i].id) || (current.seatIds || [])[i] || null);

      const players = endPlayers.map((ep, i) => {
        const lp = live[i] || {};
        const role = roleInfo(roleIdOf(ep.role) || roleIdOf(lp.role));
        const alignment = alignmentOf(ep.alignment || lp.alignment, role.team);
        const statusArr = ep.status || lp.status || [];
        const death = [...current.deaths].reverse().find((d) => d.seat === i + 1);
        const startId = current.startingRoles[String(i + 1)] || null;
        return {
          seat: i + 1,
          userId: seatId(i),
          username: username(seatId(i)),
          roleId: role.id,
          icon: iconUrl(role.id, alignment),
          roleName: role.name,
          team: role.team,
          alignment,
          isTraveller: role.team === 'traveller',
          startingRoleId: startId,
          startingRoleName: startId ? roleInfo(startId).name : null,
          reminders: Object.values((current.reminders || {})[String(i + 1)] || {}).map((r) => ({ role: r.role, source: reminderSource(r.role), name: r.name, icon: iconUrl(r.role || 'custom') })),
          deadVoteUsed: !!((current.voteless || {})[String(i + 1)] || (statusArr.includes('voteless'))),
          survived: !statusArr.includes('dead'),
          diedPhase: death ? death.phase : null,
          won: alignment ? (alignment === 'evil') === isEvilWin : null,
        };
      }).filter((p) => p.userId || p.roleId);

      const ed = S.edition || {};
      const stIds = current.frozen ? current.frozen.stIds : [...new Set([...(current.stIds || []), ...S.players.storytellers.map((s) => s.id).filter(Boolean)])];
      const storytellers = stIds.map((id) => ({ userId: id, username: username(id) }));
      const me = S.user.user || {};

      return {
        schema: SCHEMA_VERSION,
        id: current.id,
        room: current.room,
        startedAt: current.startedAt,
        endedAt: end.time || Date.now(),
        joinedAtPhase: current.joinedAtPhase || 0,
        script: { id: ed.id || null, name: ed.name || ed.id || null, author: ed.author || null, isOfficial: ed.isOfficial !== false && !['custom', 'homebrew'].includes(ed.id) },
        winner: isEvilWin ? 'evil' : 'good',
        storytellers,
        playerCount: players.filter((p) => !p.isTraveller).length,
        travellerCount: players.filter((p) => p.isTraveller).length,
        phases: phase,
        days: Math.ceil(phase / 2),
        bluffs: (current.bluffs || []).map((id) => ({ id, name: roleInfo(id).name, icon: iconUrl(id) })),
        fabled: (data.npcs || S.players.npcs.map((n) => n.id) || []).map((id) => ({ id, name: npcName(id), icon: iconUrl(id) })),
        background: backgroundInfo(),
        players,
        nominations: current.nominations,
        deaths: current.deaths.map((d) => ({ ...d, username: username(d.userId) })),
        capturedBy: { userId: me.id || null, username: me.username || null, asStoryteller: hasGrimoireAccess() },
        capturedAt: Date.now(),
      };
    }

    // ---------- nominations & votes ----------
    function onVote() {
      const v = S.vote;
      if (Array.isArray(v.nomination) && v.nomination.length >= 2) {
        const [from, to] = v.nomination;
        const key = `${S.game.phase}:${from}:${to}`;
        if (activeNomination && activeNomination.key !== key) flushNomination();
        const players = S.players.players;
        activeNomination = {
          key,
          phase: S.game.phase,
          day: Math.ceil(S.game.phase / 2),
          nominatorSeat: from + 1,
          nomineeSeat: to + 1,
          nominatorId: (players[from] && players[from].id) || null,
          nomineeId: (players[to] && players[to].id) || null,
          type: players[to] && players[to].role && players[to].role.team === 'traveller' ? 'exile' : 'execution',
          votes: Array.isArray(v.votes) ? [...v.votes] : [],
          locked: v.locked,
          isHidden: !!v.isHidden,
          playerCount: players.length,
          aliveCount: players.filter((p) => !isDead(p)).length,
          at: (activeNomination && activeNomination.at) || Date.now(),
        };
      } else if (activeNomination) {
        flushNomination();
      }
    }

    function flushNomination() {
      const n = activeNomination;
      activeNomination = null;
      if (!n || !current) return;
      const completed = n.locked > n.playerCount;
      const voterSeats = [];
      let total = 0;
      n.votes.forEach((val, i) => { if (val) { voterSeats.push(i + 1); total += Number(val) || 0; } });
      const voteHidden = n.isHidden || (completed && !n.votes.length);
      const users = S.players.players;
      current.nominations.push({
        phase: n.phase,
        day: n.day,
        nominatorSeat: n.nominatorSeat,
        nominatorId: n.nominatorId,
        nominator: username(n.nominatorId),
        nomineeSeat: n.nomineeSeat,
        nomineeId: n.nomineeId,
        nominee: username(n.nomineeId),
        type: n.type,
        completed,
        votes: !voteHidden ? total : null,
        voters: !voteHidden ? voterSeats.map((s) => ({ seat: s, userId: (users[s - 1] && users[s - 1].id) || null, username: username(users[s - 1] && users[s - 1].id) })) : [],
        majority: n.type === 'exile' ? Math.ceil(n.playerCount / 2) : Math.ceil(n.aliveCount / 2),
        at: n.at,
      });
      persist();
    }

    // ---------- deaths ----------
    function onPlayers() {
      if (!current || current.saved || current.alreadyOver) return;
      const players = S.players.players;
      players.forEach((p, i) => {
        const dead = isDead(p);
        if (dead && !prevDead[i]) {
          current.deaths.push({ seat: i + 1, userId: p.id || null, phase: S.game.phase, day: Math.ceil(S.game.phase / 2), atNight: !!(S.game.phase % 2) });
        } else if (!dead && prevDead[i]) {
          // Resurrected, or the storyteller fixed a misclick.
          const idx = current.deaths.map((d) => d.seat).lastIndexOf(i + 1);
          if (idx >= 0) current.deaths.splice(idx, 1);
        }
      });
      prevDead = players.map(isDead);
      if (S.game.phase <= 2) snapshotStartingRoles();
      remember();
      persist();
    }

    // ---------- subscriptions ----------
    store.subscribe(({ type }) => {
      try {
        if (type.startsWith('game/')) onHistory();
        else if (type.startsWith('vote/')) onVote();
        else if (type.startsWith('players/')) {
          clearTimeout(playersTimer);
          playersTimer = setTimeout(() => {
            onPlayers();
            // Late reveals (e.g. roles filled in after the end overlay) refresh the saved record.
            if (current && current.saved) scheduleFinalize(1500);
          }, 50);
        } else if (type === 'session/setSessionId' || type === 'session/toggleConnected') status();
        else if (type === 'setRolesAvailable' || type === 'setNPCs') { clearTimeout(rolesTimer); rolesTimer = setTimeout(shareRoles, 500); }
      } catch (e) {
        console.warn('[Clockwise] error handling', type, e);
      }
    });

    // Handle state that already exists when we attach (e.g. page reload mid-game).
    onHistory();
    if (current) prevDead = S.players.players.map(isDead);
    status();
    setInterval(status, 15000);

    window.__botcTracker = {
      version: SCHEMA_VERSION,
      current: () => current && JSON.parse(JSON.stringify(current)),
      rebuild: () => { const end = [...S.game.history].reverse().find((h) => h.type === 'end'); return end && current ? buildRecord(end) : null; },
      forceSave: finalize,
    };
    onPing = status;
    shareImageMap();
    shareRoles();
    log('attached');
  }

  // Each character's night order, reminder count, setup flag and edition, so the dashboard's tokens can
  // show the same leaves and token art as the game. Shared whenever botc.app loads its character list.
  let rolesTimer = null;
  function shareRoles() {
    try {
      const S = findStore().state;
      const list = [...(S.rolesAvailable instanceof Map ? S.rolesAvailable.values() : []), ...(S.npcs instanceof Map ? S.npcs.values() : [])];
      const roles = {};
      for (const r of list) {
        if (!r || !r.id) continue;
        roles[r.id] = [r.firstNight || r.firstNightReminder ? 1 : 0, r.otherNight || r.otherNightReminder ? 1 : 0,
          (r.reminders || []).length + (r.remindersGlobal || []).length, r.setup ? 1 : 0, r.edition || ''];
      }
      if (Object.keys(roles).length > 20) emit('roles', { roles });
    } catch (e) {
      console.debug('[Clockwise] could not read the character list', e);
    }
  }

  // botc.app's image file names change with each release (they carry a hash). Read the current
  // list from its own code so the dashboard can always find a character's or background's image.
  async function shareImageMap() {
    try {
      const script = [...document.scripts].find((s) => /\/assets\/index-[^/]+\.js$/.test(s.src));
      if (!script) return;
      const code = await (await fetch(script.src)).text();
      const files = {};
      for (const m of code.matchAll(/(?:^|[,;{ ])([A-Za-z_$][\w$]*)=`(\/assets\/[^`]+?\.webp)`/g)) files[m[1]] = m[2];
      const map = {};
      for (const m of code.matchAll(/"\/src\/assets\/([^"]+?\.webp)":([A-Za-z_$][\w$]*)/g)) {
        if (files[m[2]] && /^(icons|editions|background|shroud|death)/.test(m[1])) map[m[1]] = new URL(files[m[2]], location.origin).href;
      }
      if (Object.keys(map).length > 50) emit('assets', { source: script.src, map });
    } catch (e) {
      console.debug('[Clockwise] could not read image list', e);
    }
  }

  // The popup can ask for a fresh status at any time (relayed by bridge.js).
  let onPing = () => emit('status', { attached: false, at: Date.now() });
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source === window && msg && msg[MSG_FLAG] === true && msg.dir === 'in' && msg.type === 'ping') onPing();
  });

  window.__botcTracker = { pending: true };
  const timer = setInterval(() => {
    const store = findStore();
    if (store && store.state && store.state.game) {
      clearInterval(timer);
      attach(store);
    }
  }, 500);
})();
