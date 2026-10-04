/* ============================================================================
 *  海南高考化学真题在线练习平台 —— 交互逻辑
 *  依赖：各 data/paper_*.js 向全局 window.PAPERS 注入试卷对象
 *  试卷对象：{ id, year, version, source, single[], multiple[], converted[] }
 *  题目对象：{ id, stem, options[4], answer(数字或数组), hint, originalType? }
 * ========================================================================== */
(function () {
  "use strict";

  var PAPERS = (typeof window.PAPERS !== "undefined") ? window.PAPERS : [];
  var TYPE_ORDER = ["single", "multiple", "converted"];
  var TYPE_LABEL = { single: "单选题", multiple: "不定项选择题", converted: "原为填空题" };
  var LETTERS = ["A", "B", "C", "D"];

  // 每道题作答状态：{ qid, paperId, year, version, type, q, selected[], submitted, status }
  var state = {};
  var currentPaperId = PAPERS.length ? PAPERS[0].id : null;
  var filterType = "all";

  var $ = function (id) { return document.getElementById(id); };
  var elPaper = $("filter-paper");
  var elType = $("filter-type");
  var elQuestions = $("questions");
  var elEmpty = $("empty");
  var elResult = $("result");

  // ---- 数据扁平化（仅当前试卷）----
  function flatten() {
    var paper = PAPERS.filter(function (p) { return p.id === currentPaperId; })[0];
    if (!paper) return [];
    var list = [];
    TYPE_ORDER.forEach(function (t) {
      (paper[t] || []).forEach(function (q) {
        var rec = state[q.id] || {
          qid: q.id, paperId: paper.id, year: paper.year, version: paper.version,
          type: t, q: q, selected: [], submitted: false, status: "unanswered"
        };
        rec.paperId = paper.id; rec.year = paper.year; rec.version = paper.version;
        rec.type = t; rec.q = q;
        state[q.id] = rec;
        list.push(rec);
      });
    });
    return list;
  }

  function getFiltered() {
    return flatten().filter(function (r) {
      if (filterType !== "all" && r.type !== filterType) return false;
      return true;
    });
  }

  // ---- 渲染 ----
  function render() {
    var list = getFiltered();
    elQuestions.innerHTML = "";

    if (list.length === 0) {
      elEmpty.classList.remove("hidden");
    } else {
      elEmpty.classList.add("hidden");
    }

    list.forEach(function (rec, idx) {
      elQuestions.appendChild(buildCard(rec, idx + 1));
    });

    updateStats(list);
  }

  function buildCard(rec, no) {
    var card = document.createElement("div");
    card.className = "q-card";
    card.setAttribute("data-qid", rec.qid);

    // 头部：题号 + 试卷(年份·真题N) + 题型标签
    var paperLabel = rec.year + " 年 · " + rec.version;
    var head = document.createElement("div");
    head.className = "q-head";
    head.innerHTML =
      '<div class="q-no">' + no + '</div>' +
      '<span class="q-paper">' + paperLabel + '</span>' +
      '<span class="tag tag-' + rec.type + '">' + TYPE_LABEL[rec.type] + '</span>';
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

    // 反馈区（含解题提示）
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

  function buildFeedback(rec) {
    var box = document.createElement("div");
    if (rec.status === "correct") {
      box.className = "feedback ok";
      box.innerHTML = '<div class="hd">✓ 回答正确</div>';
    } else {
      box.className = "feedback no";
      var combo = "";
      if (rec.type === "multiple") {
        var letters = rec.q.answer.slice().sort().map(function (x) { return LETTERS[x]; }).join("、");
        combo = '<div class="hd">✗ 回答错误　正确组合：' + letters + '</div>';
      } else {
        combo = '<div class="hd">✗ 回答错误　正确答案：' + LETTERS[rec.q.answer] + '</div>';
      }
      box.innerHTML = combo;
    }
    // 解题提示：无论对错都给出，帮助学懂弄通
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.innerHTML = '<span class="lab">💡 解题提示：</span>' + escapeHtml(rec.q.hint || "（暂无提示）");
    box.appendChild(hint);
    return box;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  // ---- 交互 ----
  elQuestions.addEventListener("click", function (e) {
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
  });

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
  }

  // ---- 统计与完成 ----
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

    if (total > 0 && answered === total) {
      $("r-score").textContent = correct;
      $("r-total").textContent = total;
      $("r-acc").textContent = Math.round((correct / total) * 100) + "%";
      elResult.classList.remove("hidden");
    } else {
      elResult.classList.add("hidden");
    }
  }

  // ---- 重置（仅当前试卷）----
  function resetCurrentPaper() {
    Object.keys(state).forEach(function (k) {
      if (state[k].paperId === currentPaperId) {
        state[k].selected = [];
        state[k].submitted = false;
        state[k].status = "unanswered";
      }
    });
    render();
  }

  // ---- 初始化 ----
  function init() {
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
      currentPaperId = elPaper.value;
      filterType = "all";
      elType.value = "all";
      render();
    });
    elType.addEventListener("change", function () { filterType = elType.value; render(); });
    $("btn-reset").addEventListener("click", resetCurrentPaper);
    $("btn-reset2").addEventListener("click", resetCurrentPaper);

    render();
  }

  init();
})();
