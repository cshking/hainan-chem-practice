/* ============================================================================
 *  海南高考历史真题精练 · 学懂弄通版 —— 交互逻辑
 *  依赖：各 data/paper_*.js 向全局 window.PAPERS 注入试卷对象
 *  试卷对象：{ id, year, version, source, single[], multiple[], converted[] }
 *  题目对象：{ id, stem, options[4], answer(数字或数组), hint, knowledgePoint, originalType? }
 *
 *  老师的学习法：
 *   1) 每题拆解到纳米知识点（knowledgePoint + hint）
 *   2) 做错 → 明确“你错在哪里” + “需重点领悟的知识点”
 *   3) 做错 → 必须用自己的话“重述知识点”（重述框，≥MIN_RESTATE 字）
 *   4) 整套题有错就必须“重新做一遍”，直到本轮全部正确方可过关
 * ========================================================================== */
(function () {
  "use strict";

  var PAPERS = (typeof window.PAPERS !== "undefined") ? window.PAPERS : [];
  var TYPE_ORDER = ["single", "multiple", "converted"];
  var TYPE_LABEL = { single: "选择题", multiple: "非选择题（多选）", converted: "原为填空题" };
  var LETTERS = ["A", "B", "C", "D"];
  var MIN_RESTATE = 15; // 重述知识点最少字数

  // 每道题作答状态：{ qid, paperId, year, version, type, q, selected[], submitted, status, restated }
  var state = {};
  var currentPaperId = PAPERS.length ? PAPERS[0].id : null;
  var filterType = "all";
  var round = 1;                 // 当前练习轮次
  var everWrong = {};            // qid -> true：本套练习中曾答错（用于“易错”标记）

  var $ = function (id) { return document.getElementById(id); };
  var elPaper = $("filter-paper");
  var elType = $("filter-type");
  var elQuestions = $("questions");
  var elEmpty = $("empty");
  var elResult = $("result");
  var elRound = $("st-round");
  var elFlaw = $("st-flaw");

  // ---- 本地进度存档（localStorage，每套试卷独立；同浏览器/设备可续练）----
  // 只持久化作答标量字段（selected/submitted/status/restated），题面由 flatten() 按 PAPERS 补全，
  // 因此题库更新不会破坏存档；不破坏老师“学懂弄通”四步闭环。
  var LS_PREFIX = "chem_prog_v1_";   // 每套试卷存档键前缀
  var LS_META = "chem_prog_meta_v1"; // 全局：上次试卷 + 筛选条件
  var LS_AVAIL = (function () {
    try {
      var k = "__chem_t__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) {} }
  function lsDel(key) { try { window.localStorage.removeItem(key); } catch (e) {} }
  function paperStoreKey(pid) { return LS_PREFIX + pid; }

  // 把当前试卷的作答 / 重述 / 易错 / 轮次写入 localStorage
  function persistCurrent() {
    if (!LS_AVAIL || !currentPaperId) return;
    var answers = {};
    Object.keys(state).forEach(function (k) {
      var r = state[k];
      if (r && r.paperId === currentPaperId) {
        answers[k] = {
          sel: r.selected || [],
          sub: r.submitted ? 1 : 0,
          st: r.status === "correct" ? "c" : (r.status === "wrong" ? "w" : "u"),
          rs: r.restated || ""
        };
      }
    });
    var ew = [];
    Object.keys(everWrong).forEach(function (k) { if (everWrong[k]) ew.push(k); });
    var payload = { v: 1, round: round, everWrong: ew, answers: answers, ts: Date.now() };
    lsSet(paperStoreKey(currentPaperId), JSON.stringify(payload));
    lsSet(LS_META, JSON.stringify({ lastPaper: currentPaperId, lastFilter: filterType }));
  }

  // 从 localStorage 恢复指定试卷：先清空内存中的 round/everWrong，再按存档重建
  // （只恢复 selected/submitted/status/restated；paperId/year/version/type/q 由 flatten() 补全）
  function loadPaper(pid) {
    if (!LS_AVAIL || !pid) return;
    round = 1;
    everWrong = {};
    var raw = lsGet(paperStoreKey(pid));
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (data.round) round = data.round;
    (data.everWrong || []).forEach(function (k) { everWrong[k] = true; });
    Object.keys(data.answers || {}).forEach(function (qid) {
      var a = data.answers[qid];
      state[qid] = {
        qid: qid,
        selected: a.sel || [],
        submitted: !!a.sub,
        status: a.st === "c" ? "correct" : (a.st === "w" ? "wrong" : "unanswered"),
        restated: a.rs || ""
      };
    });
  }

  function clearPaperProgress(pid) {
    if (!LS_AVAIL || !pid) return;
    lsDel(paperStoreKey(pid));
  }

  // ---- 数据扁平化（仅当前试卷）----
  function flatten() {
    var paper = PAPERS.filter(function (p) { return p.id === currentPaperId; })[0];
    if (!paper) return [];
    var list = [];
    TYPE_ORDER.forEach(function (t) {
      (paper[t] || []).forEach(function (q) {
        var rec = state[q.id] || {
          qid: q.id, paperId: paper.id, year: paper.year, version: paper.version,
          type: t, q: q, selected: [], submitted: false, status: "unanswered", restated: ""
        };
        rec.paperId = paper.id; rec.year = paper.year; rec.version = paper.version;
        rec.type = t; rec.q = q;
        state[q.id] = rec;
        list.push(rec);
      });
    });
    return list;
  }

  // ---- 渲染 ----
  function render() {
    var all = flatten();
    var list = all.filter(function (r) {
      return filterType === "all" || r.type === filterType;
    });
    elQuestions.innerHTML = "";

    if (list.length === 0) {
      elEmpty.classList.remove("hidden");
    } else {
      elEmpty.classList.add("hidden");
    }

    list.forEach(function (rec, idx) {
      elQuestions.appendChild(buildCard(rec, idx + 1));
    });

    updateStats(all); // 成绩与“过关/重做”判定始终基于整套题，与筛选无关
    persistCurrent(); // 自动保存当前试卷进度（同设备续练）
  }

  function buildCard(rec, no) {
    var card = document.createElement("div");
    card.className = "q-card";
    card.setAttribute("data-qid", rec.qid);

    // 头部：题号 + 试卷(年份·真题N) + 题型标签 + （曾错）易错标签
    var paperLabel = rec.year + " 年 · " + rec.version;
    var head = document.createElement("div");
    head.className = "q-head";
    var headHtml =
      '<div class="q-no">' + no + '</div>' +
      '<span class="q-paper">' + paperLabel + '</span>';
    if (rec.q.originalType) headHtml += '<span class="tag tag-converted">原为' + escapeHtml(rec.q.originalType) + '</span>';
    headHtml += '<span class="tag tag-' + rec.type + '">' + TYPE_LABEL[rec.type] + '</span>';
    if (everWrong[rec.qid]) headHtml += '<span class="tag tag-flaw">⚠ 易错</span>';
    head.innerHTML = headHtml;
    card.appendChild(head);

    // 题干
    var stem = document.createElement("div");
    stem.className = "q-stem";
    stem.textContent = rec.q.stem;
    card.appendChild(stem);

    // 选项
    var opts = document.createElement("div");
    opts.className = "options";
    rec.q.options.forEach(function (text, i) {
      var o = document.createElement("div");
      o.className = "opt";
      o.setAttribute("data-idx", i);
      var cls = optClass(rec, i);
      if (cls) o.className += " " + cls;
      o.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span class="otext"></span>';
      o.querySelector(".otext").textContent = text;
      opts.appendChild(o);
    });
    card.appendChild(opts);

    // 不定项：提交按钮
    if (rec.type === "multiple") {
      var row = document.createElement("div");
      row.className = "submit-row";
      var btn = document.createElement("button");
      btn.className = "btn-submit";
      btn.textContent = "提交答案";
      btn.disabled = rec.submitted || rec.selected.length === 0;
      btn.addEventListener("click", function () { submitMultiple(rec.qid); });
      row.appendChild(btn);
      card.appendChild(row);
    }

    // 反馈区（含知识点拆解 / 错因 / 重述框）
    var fb = document.createElement("div");
    fb.className = "feedback";
    if (rec.submitted) {
      fb.appendChild(buildFeedback(rec));
    } else {
      fb.style.display = "none";
    }
    card.appendChild(fb);

    return card;
  }

  function optClass(rec, i) {
    if (!rec.submitted) {
      if (rec.selected.indexOf(i) !== -1) return "sel-pending";
      return "";
    }
    if (rec.type === "multiple") {
      var inAns = rec.q.answer.indexOf(i) !== -1;
      var inSel = rec.selected.indexOf(i) !== -1;
      if (inAns) return "correct";
      if (inSel && !inAns) return "wrong";
      return "";
    } else {
      if (i === rec.q.answer) return "correct";
      if (rec.selected.indexOf(i) !== -1) return "wrong";
      return "";
    }
  }

  function restateOk(rec) {
    return !!(rec.restated && rec.restated.trim().length >= MIN_RESTATE);
  }

  function buildFeedback(rec) {
    var box = document.createElement("div");
    var kp = rec.q.knowledgePoint || "（见下方拆解讲解）";

    if (rec.status === "correct") {
      box.className = "feedback ok";
      box.innerHTML = '<div class="hd">✓ 回答正确，已掌握该知识点</div>';
      var k1 = document.createElement("div");
      k1.className = "kp";
      k1.innerHTML = '<span class="lab">📌 本题知识点：</span>' + escapeHtml(kp);
      box.appendChild(k1);
      var h1 = document.createElement("div");
      h1.className = "hint";
      h1.innerHTML = '<span class="lab">💡 拆解讲解：</span>' + escapeHtml(rec.q.hint || "（暂无讲解）");
      box.appendChild(h1);
    } else {
      box.className = "feedback no";
      var selLetters = rec.selected.slice().sort(function (a, b) { return a - b; })
        .map(function (i) { return LETTERS[i]; }).join("、");
      var ansArr = (Array.isArray(rec.q.answer) ? rec.q.answer : [rec.q.answer])
        .slice().sort(function (a, b) { return a - b; })
        .map(function (i) { return LETTERS[i]; }).join("、");

      var err = document.createElement("div");
      err.className = "err";
      if (rec.type === "multiple") {
        err.innerHTML = '<span class="lab">🔍 你错在哪里：</span>你选了 <b>' + selLetters +
          '</b>，正确组合应为 <b>' + ansArr + '</b>。' +
          (selLetters !== ansArr ? '存在漏选或错选——未选中的正确项同样要掌握，错选的项要弄清为何不对。' : '') +
          '请结合下方拆解逐选项分析。';
      } else {
        err.innerHTML = '<span class="lab">🔍 你错在哪里：</span>你选择了 <b>' + selLetters +
          '</b>，但正确答案是 <b>' + ansArr + '</b>。你选的选项不符合题意，原因见下方拆解；请重点领悟上方知识点。';
      }
      box.appendChild(err);

      var k2 = document.createElement("div");
      k2.className = "kp";
      k2.innerHTML = '<span class="lab">🎯 需重点领悟的知识点：</span>' + escapeHtml(kp);
      box.appendChild(k2);

      var h2 = document.createElement("div");
      h2.className = "hint";
      h2.innerHTML = '<span class="lab">💡 拆解讲解：</span>' + escapeHtml(rec.q.hint || "（暂无讲解）");
      box.appendChild(h2);

      // 重述知识点区（做错必做）
      var rs = document.createElement("div");
      rs.className = "restate";
      rs.innerHTML = '<div class="rs-lab">✍️ 错题为师：请用你自己的话写出这道题目的知识点（≥' +
        MIN_RESTATE + ' 字），写完才算真正弄懂：</div>';
      var ta = document.createElement("textarea");
      ta.className = "rs-ta";
      ta.setAttribute("data-qid", rec.qid);
      ta.placeholder = "例如：勒夏特列原理——增大压强，平衡向气体分子数减少的方向移动……";
      ta.value = rec.restated || "";
      rs.appendChild(ta);
      var ind = document.createElement("div");
      ind.className = "rs-ind";
      ind.setAttribute("data-ind", rec.qid);
      ind.textContent = restateOk(rec) ? "✓ 已重述，知识点已记录" : "";
      rs.appendChild(ind);
      box.appendChild(rs);
    }
    return box;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  // ---- 交互 ----
  function onCardClick(e) {
    var optEl = e.target.closest ? e.target.closest(".opt") : null;
    if (!optEl) return;
    var card = optEl.closest(".q-card");
    if (!card) return;
    var qid = card.getAttribute("data-qid");
    var idx = parseInt(optEl.getAttribute("data-idx"), 10);
    var rec = state[qid];
    if (!rec || rec.submitted) return; // 已作答则锁定

    if (rec.type === "multiple") {
      var pos = rec.selected.indexOf(idx);
      if (pos === -1) rec.selected.push(idx);
      else rec.selected.splice(pos, 1);
      render();
    } else {
      rec.selected = [idx];
      judge(rec);
      render();
    }
  }

  function onRestateInput(e) {
    if (!(e.target.classList && e.target.classList.contains("rs-ta"))) return;
    var qid = e.target.getAttribute("data-qid");
    var rec = state[qid];
    if (!rec) return;
    rec.restated = e.target.value;
    var ind = elQuestions.querySelector('.rs-ind[data-ind="' + qid + '"]');
    if (ind)     ind.textContent = restateOk(rec) ? "✓ 已重述，知识点已记录" : "";
    renderResultPanel(flatten()); // 实时更新底部“是否可进入下一轮”
    persistCurrent();             // 重述内容自动存档
  }

  function onResultClick(e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "redo") doRedo();
    else if (act === "finish") resetCurrentPaper();
  }

  function submitMultiple(qid) {
    var rec = state[qid];
    if (!rec || rec.submitted) return;
    if (rec.selected.length === 0) return;
    judge(rec);
    render();
  }

  function judge(rec) {
    var sel = rec.selected.slice().sort(function (a, b) { return a - b; });
    var ans = (Array.isArray(rec.q.answer) ? rec.q.answer : [rec.q.answer])
      .slice().sort(function (a, b) { return a - b; });
    var isCorrect = sel.length === ans.length && sel.every(function (v, i) { return v === ans[i]; });
    rec.status = isCorrect ? "correct" : "wrong";
    rec.submitted = true;
    if (!isCorrect) everWrong[rec.qid] = true;
  }

  // ---- 统计与“过关 / 重做”闭环 ----
  function updateStats(list) {
    var total = list.length;
    var answered = 0, correct = 0;
    list.forEach(function (r) {
      if (r.submitted) { answered++; if (r.status === "correct") correct++; }
    });
    $("st-total").textContent = total;
    $("st-answered").textContent = answered;
    $("st-correct").textContent = correct;
    $("st-acc").textContent = answered > 0 ? Math.round((correct / answered) * 100) + "%" : "—";
    elRound.textContent = round;
    var flaw = 0;
    Object.keys(everWrong).forEach(function (k) {
      if (state[k] && state[k].paperId === currentPaperId) flaw++;
    });
    elFlaw.textContent = flaw;

    renderResultPanel(list);
  }

  function renderResultPanel(list) {
    var total = list.length;
    var answered = list.filter(function (r) { return r.submitted; }).length;
    var correct = list.filter(function (r) { return r.status === "correct"; }).length;
    var wrong = list.filter(function (r) { return r.submitted && r.status === "wrong"; });

    if (total === 0 || answered < total) {
      elResult.className = "result hidden";
      return;
    }
    elResult.classList.remove("hidden");

    if (correct === total) {
      // 通关：本轮全部正确
      elResult.className = "result win";
      elResult.innerHTML =
        '<div class="score">🎉 <b>第 ' + round + ' 轮全部正确！</b> 本套 ' + total +
        ' 题知识点已真正掌握，可以过关。</div>' +
        '<button class="btn btn-primary" data-act="finish">再练一次（巩固）</button>';
    } else {
      var need = wrong.filter(function (r) { return !restateOk(r); });
      if (need.length > 0) {
        // 还有错题没重述知识点 → 先完成重述
        elResult.className = "result warn";
        elResult.innerHTML =
          '<div class="score">✍️ 还有 <b>' + need.length + '</b> 道错题未完成「重述知识点」。' +
          '请先写完每道错题下方的重述框（≥' + MIN_RESTATE + ' 字），才能进入下一轮重做。</div>';
      } else {
        // 错题已重述 → 必须整套重做
        elResult.className = "result redo";
        elResult.innerHTML =
          '<div class="score">⚠️ 本轮有 <b>' + wrong.length + '</b> 题未掌握（知识点已重述）。' +
          '按老师要求：<b>必须重新做一遍，直到全部正确</b>。</div>' +
          '<button class="btn btn-primary" data-act="redo">🔄 重新做一遍（第 ' + (round + 1) + ' 轮）</button>';
      }
    }
  }

  // 整套重做（保留“易错”标记，提醒孩子重点）
  function doRedo() {
    round++;
    Object.keys(state).forEach(function (k) {
      if (state[k].paperId === currentPaperId) {
        state[k].selected = [];
        state[k].submitted = false;
        state[k].status = "unanswered";
        state[k].restated = "";
      }
    });
    render();
    window.scrollTo(0, 0);
  }

  // 一键重练（清本轮：清作答、清重述、清易错、轮次归 1）
  function resetCurrentPaper() {
    Object.keys(state).forEach(function (k) {
      if (state[k].paperId === currentPaperId) {
        state[k].selected = [];
        state[k].submitted = false;
        state[k].status = "unanswered";
        state[k].restated = "";
      }
    });
    everWrong = {};
    round = 1;
    render();
  }

  // ---- 初始化 ----
  function init() {
    // 恢复上次进度（同一浏览器/设备续练）
    if (LS_AVAIL) {
      try {
        var meta = JSON.parse(lsGet(LS_META) || "{}");
        if (meta.lastPaper && PAPERS.some(function (p) { return p.id === meta.lastPaper; })) {
          currentPaperId = meta.lastPaper;
          if (meta.lastFilter) filterType = meta.lastFilter;
        }
      } catch (e) {}
      loadPaper(currentPaperId);
    }

    // 试卷下拉：按年份分组，真题1 / 真题2 ...
    var years = Array.from(new Set(PAPERS.map(function (p) { return p.year; }))).sort();
    var html = "";
    years.forEach(function (y) {
      html += '<optgroup label="' + y + ' 年">';
      PAPERS.filter(function (p) { return p.year === y; }).forEach(function (p) {
        html += '<option value="' + p.id + '"' +
          (p.id === currentPaperId ? " selected" : "") +
          ' title="' + escapeHtml(p.source || "") + '">' + p.version + '</option>';
      });
      html += '</optgroup>';
    });
    elPaper.innerHTML = html;

    elPaper.addEventListener("change", function () {
      persistCurrent();          // 先保存旧卷进度（此时 currentPaperId 仍是旧卷）
      currentPaperId = elPaper.value;
      filterType = "all";
      elType.value = "all";
      loadPaper(currentPaperId); // 恢复新卷进度
      render();
    });
    elType.value = filterType; // 恢复上次筛选条件
    elType.addEventListener("change", function () { filterType = elType.value; render(); });
    $("btn-reset").addEventListener("click", resetCurrentPaper);
    $("btn-reset2") && $("btn-reset2").addEventListener("click", resetCurrentPaper);

    elQuestions.addEventListener("click", onCardClick);
    elQuestions.addEventListener("input", onRestateInput);
    elResult.addEventListener("click", onResultClick);

    render();
  }

  init();
})();
