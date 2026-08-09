// ===================================================
// admin-common.js — โค้ดที่ใช้ร่วมกันในทุกหน้าคอนโซลแอดมิน
// (admin-school.html / admin-grade.html / admin-cases.html)
// ===================================================

const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbz1EonZ6j5l8Ci_ySnbzKQjXQvRtyIVOaFBRF2uilEafmJiNAmem5LtZYQ5GjdXJTLP/exec';

const $ = id => document.getElementById(id);

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

// ---------- ป้องกันหน้าแอดมิน: ต้องล็อกอินแอดมินมาก่อนเท่านั้น (รหัสเดียวใช้ร่วมกันทั้งโรงเรียน ไม่จำกัดว่าใคร) ----------
function requireAdminSession() {
  if (sessionStorage.getItem('role') !== 'admin') {
    window.location.href = 'index.html';
  }
}

function handleLogout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

function showLoader(msg) { $('loaderMsg').textContent = msg || 'กำลังสื่อสารกับฐานข้อมูล...'; $('loader').classList.add('show'); }
function hideLoader() { $('loader').classList.remove('show'); }

// ---------- เรียก Apps Script backend ----------
function call(fn, args, cb) {
  fetch(BACKEND_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: fn, arguments: args })
  })
  .then(r => r.json())
  .then(res => cb(res))
  .catch(err => { hideLoader(); alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์หลังบ้าน ' + err.message); });
}

// ---------- ดึงข้อมูลแอดมิน พร้อมแคชสั้นๆ ใน sessionStorage กันเรียกซ้ำเวลาเปลี่ยนหน้าเร็วๆ ----------
function fetchAdminData(cb, forceRefresh) {
  const cacheRaw = sessionStorage.getItem('adminDataCache');
  if (!forceRefresh && cacheRaw) {
    try {
      const cache = JSON.parse(cacheRaw);
      if (Date.now() - cache.ts < 60000) { cb(cache.data); return; }
    } catch (e) {}
  }
  showLoader('กำลังดึงข้อมูลล่าสุดจากฐานข้อมูล...');
  call('getAdminData', [], data => {
    hideLoader();
    if (!data.success) { alert(data.error); return; }
    sessionStorage.setItem('adminDataCache', JSON.stringify({ ts: Date.now(), data }));
    cb(data);
  });
}

// ---------- ระดับชั้น/ห้อง: แยกเลขระดับชั้นออกจากรหัสห้อง เช่น "4/2" -> ระดับชั้น "4" ----------
function parseGrade(cls) {
  const m = String(cls).match(/(\d+)\s*[\/\.]/);
  return m ? m[1] : String(cls);
}
function gradeLabel(g) { return 'ม.' + g; }

// ---------- คำนวณขอบเขตข้อมูล (ทั้งโรงเรียน / ระดับชั้น / ห้อง) พร้อมตัวกรองเคสเสี่ยงเพิ่มเติม ----------
function computeScope(adminData, opts) {
  opts = opts || {};
  const grade  = opts.grade  || '';
  const room   = opts.room   || '';
  const filter = opts.filter || ''; // '', 'watch', 'critical'

  let progress = adminData.progress;
  if (grade) progress = progress.filter(p => parseGrade(p.class) === grade);
  if (room)  progress = progress.filter(p => p.class === room);

  let atRisk = adminData.atRisk;
  if (grade) atRisk = atRisk.filter(r => parseGrade(r.class) === grade);
  if (room)  atRisk = atRisk.filter(r => r.class === room);

  let filteredAtRisk = atRisk;
  if (filter === 'critical') filteredAtRisk = atRisk.filter(r => r.isCritical);
  if (filter === 'watch')    filteredAtRisk = atRisk.filter(r => !r.isCritical);

  const totalStudents = progress.reduce((s, p) => s + p.total, 0);
  const totalDone     = progress.reduce((s, p) => s + p.done, 0);
  const totalAtRisk   = atRisk.length;
  const totalCritical = atRisk.filter(r => r.isCritical).length;

  const scopeLabel = room ? ('ห้อง ' + room) : (grade ? ('ระดับชั้น ' + gradeLabel(grade)) : 'ทั้งโรงเรียน');

  return {
    summary: { totalStudents, totalDone, totalAtRisk, totalCritical },
    atRisk, filteredAtRisk, progress, scopeLabel, grade, room, filter
  };
}

// ---------- ระดับความเสี่ยงรวมของขอบเขตที่กำลังดูอยู่ + คำแนะนำ ----------
// เกณฑ์นี้เป็นจุดตั้งต้นสำหรับดูภาพรวมเท่านั้น ไม่ใช่เกณฑ์วินิจฉัยทางคลินิก
// แนะนำให้ฝ่ายแนะแนว/นักจิตวิทยาโรงเรียนช่วยพิจารณาปรับตัวเลขและถ้อยคำก่อนใช้งานจริง
function riskTier(summary) {
  if (summary.totalDone === 0) {
    return { key: 'nodata', label: 'ยังไม่มีข้อมูล', cls: 'tier-gray',
      guidance: 'ยังไม่มีนักเรียนส่งแบบประเมินในขอบเขตนี้' };
  }
  const pct = summary.totalAtRisk / summary.totalDone * 100;
  if (summary.totalCritical >= 2 || pct > 15) {
    return { key: 'urgent', label: '🔴 ควรดำเนินการเร่งด่วน', cls: 'tier-red', pct,
      guidance: 'ควรประสานผู้ปกครองและนักจิตวิทยาโรงเรียนโดยเร็ว พร้อมจัดประชุมทีมดูแลช่วยเหลือเพื่อวางแผนติดตามเป็นรายกรณี' };
  }
  if (summary.totalCritical === 1 || pct >= 5) {
    return { key: 'watch', label: '🟠 ควรเฝ้าระวัง', cls: 'tier-orange', pct,
      guidance: 'ครูที่ปรึกษาควรติดตามกลุ่มเฝ้าระวังเป็นรายบุคคล และจัดกิจกรรมเสริมทักษะการรับมือความเครียดในภาพรวม' };
  }
  return { key: 'normal', label: '🟢 ปกติ', cls: 'tier-green', pct,
    guidance: 'อยู่ในเกณฑ์ปกติ ติดตามตามระบบดูแลช่วยเหลือนักเรียนตามปกติ' };
}

function riskBannerHTML(scope) {
  const t = riskTier(scope.summary);
  const pctTxt = t.pct !== undefined ? t.pct.toFixed(0) + '%' : '-';
  return `
    <div class="risk-banner ${t.cls}">
      <div class="rb-title">${esc(scope.scopeLabel)} — ระดับความเสี่ยงรวม: ${t.label}</div>
      <div class="rb-body">ส่งแบบประเมินแล้ว ${scope.summary.totalDone}/${scope.summary.totalStudents} คน • กลุ่มเฝ้าระวัง ${scope.summary.totalAtRisk} คน (${pctTxt}) • กลุ่มวิกฤต ${scope.summary.totalCritical} คน</div>
      <div class="rb-guidance">${esc(t.guidance)}</div>
    </div>`;
}

// ---------- เบรดครัมบ์นำทาง ----------
function buildBreadcrumb(el, opts) {
  opts = opts || {};
  const grade = opts.grade || '';
  const room  = opts.room  || '';
  let html = `<a href="admin-school.html">ทั้งโรงเรียน</a>`;
  if (grade) {
    html += ` <span class="bc-sep">›</span> `;
    html += room
      ? `<a href="admin-grade.html?grade=${encodeURIComponent(grade)}">${esc(gradeLabel(grade))}</a>`
      : `<span class="bc-current">${esc(gradeLabel(grade))}</span>`;
  }
  if (room) {
    html += ` <span class="bc-sep">›</span> <span class="bc-current">ห้อง ${esc(room)}</span>`;
  }
  el.innerHTML = html;
}

function badgeFor(s) {
  if (!s || s === 'ไม่ได้ทำ' || s === 'ปกติ') return '<span class="badge badge-green">ปกติ</span>';
  if (s.includes('รุนแรง') || s.includes('วิกฤต')) return `<span class="badge badge-red">${esc(s)}</span>`;
  return `<span class="badge badge-orange">${esc(s)}</span>`;
}

// ===================================================
// กราฟแท่งแนวนอน (เช่น % เสี่ยงต่อระดับชั้น/ห้อง)
// items: [{ label, pct, count }]
// ===================================================
function renderBarChart(containerId, items) {
  const el = $(containerId); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="empty-note">ไม่มีข้อมูลสำหรับสร้างกราฟ</p>'; return; }
  const w = 640, barH = 26, gap = 12, leftPad = 96, rightPad = 70, topPad = 10;
  const h = topPad * 2 + items.length * (barH + gap);
  const maxBarW = w - leftPad - rightPad;
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:100%;overflow:visible;">`;
  items.forEach((it, i) => {
    const y = topPad + i * (barH + gap);
    const barW = Math.max(2, maxBarW * (Math.min(it.pct, 100) / 100));
    const color = it.pct > 15 ? 'var(--danger)' : it.pct >= 5 ? 'var(--mid-risk)' : 'var(--success)';
    svg += `<text x="${leftPad - 10}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12" fill="var(--text)">${esc(it.label)}</text>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${maxBarW}" height="${barH}" rx="7" fill="#F1F5F9"/>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${barW}" height="${barH}" rx="7" fill="${color}"/>`;
    svg += `<text x="${leftPad + maxBarW + 8}" y="${y + barH / 2 + 4}" font-size="12" fill="var(--muted)">${it.pct.toFixed(0)}% (${it.count})</text>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;
}

// ===================================================
// กราฟโดนัท (สัดส่วนปกติ/เฝ้าระวัง/วิกฤต)
// segments: [{ label, value, color }]
// ===================================================
function renderDonutChart(containerId, segments) {
  const el = $(containerId); if (!el) return;
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) { el.innerHTML = '<p class="empty-note">ไม่มีข้อมูลสำหรับสร้างกราฟ</p>'; return; }
  const r = 55, cx = 75, cy = 75, strokeW = 24;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  let svg = `<svg viewBox="0 0 300 150" width="100%" style="max-width:340px;">`;
  segments.forEach(seg => {
    if (!seg.value) return;
    const frac = seg.value / total;
    const dash = frac * circumference;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeW}" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
  });
  svg += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="600" fill="var(--text)">${total}</text>`;
  let legendY = 28;
  segments.forEach(seg => {
    svg += `<rect x="170" y="${legendY}" width="12" height="12" rx="3" fill="${seg.color}"/>`;
    svg += `<text x="188" y="${legendY + 10}" font-size="12" fill="var(--text)">${esc(seg.label)} (${seg.value})</text>`;
    legendY += 24;
  });
  svg += `</svg>`;
  el.innerHTML = svg;
}

// ===================================================
// ส่งออกรายงาน PDF (ผ่านกล่องพิมพ์ของเบราว์เซอร์ — เลือก "Save as PDF")
// ===================================================
function buildPrintReport(scope) {
  if (!scope) return;
  const t = riskTier(scope.summary);
  const now = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
  const list = scope.filteredAtRisk || scope.atRisk;

  let html = `
    <div class="pr-header">
      <img src="school-logo.png" alt="">
      <div>
        <h1>รายงานผลการคัดกรองสุขภาพจิตนักเรียน</h1>
        <p>โรงเรียนชลบุรี "สุขบท" | ขอบเขตรายงาน: ${esc(scope.scopeLabel)}</p>
      </div>
      <div class="pr-meta">พิมพ์เมื่อ ${esc(now)}<br>กลุ่มบริหารงานกิจการนักเรียน</div>
    </div>
    <div class="pr-tier">ระดับความเสี่ยงรวม: ${t.label} — ${esc(t.guidance)}</div>
    <div class="pr-summary">
      <div class="pr-stat"><div class="n">${scope.summary.totalStudents}</div><div class="l">นักเรียนทั้งหมด</div></div>
      <div class="pr-stat"><div class="n">${scope.summary.totalDone}</div><div class="l">ส่งแบบประเมินแล้ว</div></div>
      <div class="pr-stat"><div class="n">${scope.summary.totalAtRisk}</div><div class="l">กลุ่มเฝ้าระวัง</div></div>
      <div class="pr-stat"><div class="n">${scope.summary.totalCritical}</div><div class="l">กลุ่มวิกฤต</div></div>
    </div>`;

  if (scope.progress.length > 1) {
    html += `<div class="pr-section-title">📈 สรุปความคืบหน้ารายห้องเรียน</div>
    <table class="pr-table"><thead><tr><th>ห้อง</th><th>นักเรียนทั้งหมด</th><th>ส่งแล้ว</th><th>ค้างส่ง</th><th>คิดเป็น %</th></tr></thead><tbody>`;
    scope.progress.forEach(row => {
      html += `<tr><td>${esc(row.class)}</td><td>${row.total}</td><td>${row.done}</td><td>${row.total - row.done}</td><td>${row.percent}%</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="pr-section-title">🔴 รายชื่อนักเรียนกลุ่มเสี่ยง (${list.length} คน)</div>`;
  if (!list.length) {
    html += `<p style="font-size:.75rem;color:#64748B;">ไม่พบนักเรียนกลุ่มเสี่ยงในขอบเขตที่เลือก</p>`;
  } else {
    html += `<table class="pr-table"><thead><tr><th>#</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ห้อง</th><th>เลขที่</th><th>PHQ-A</th><th>ST5</th><th>GAD-2</th><th>สังคม</th><th>8Q</th><th>ผลประเมินรวม</th><th>วันที่ทำแบบประเมิน</th></tr></thead><tbody>`;
    list.forEach((r, i) => {
      html += `<tr class="${r.isCritical ? 'pr-crit' : ''}">
        <td>${i + 1}${r.isCritical ? ' 🚨' : ''}</td><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.class)}</td><td>${esc(r.number)}</td>
        <td>${esc(r.phqaStatus)} (${r.phqaScore})</td><td>${esc(r.st5Status)} (${r.st5Score})</td><td>${esc(r.gad2Status || '-')} (${r.gad2Score ?? '-'})</td><td>${esc(r.socStatus || '-')}</td><td>${esc(r.q8Status)} (${r.q8Score})</td>
        <td><strong>${esc(r.overall)}</strong></td><td>${esc(r.timestamp)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="pr-footer">เอกสารนี้เป็นข้อมูลลับด้านสุขภาพจิตของนักเรียน ห้ามเผยแพร่นอกเหนือจากบุคลากรที่เกี่ยวข้องกับการดูแลช่วยเหลือ | ระบบประเมินสุขภาพจิตนักเรียน โรงเรียนชลบุรี "สุขบท"</div>`;

  $('printReport').innerHTML = html;
  window.print();
}

// ===================================================
// ส่งออก Excel (.xlsx) ผ่านไลบรารี SheetJS — ต้องโหลด <script src=".../xlsx.full.min.js"> ในหน้าก่อนเรียกใช้
// ===================================================
function buildExcelExport(scope) {
  if (!scope || typeof XLSX === 'undefined') { alert('ไม่พบไลบรารีสำหรับสร้างไฟล์ Excel กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'); return; }
  const t = riskTier(scope.summary);
  const list = scope.filteredAtRisk || scope.atRisk;
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['รายงานผลการคัดกรองสุขภาพจิตนักเรียน'],
    ['โรงเรียนชลบุรี "สุขบท"'],
    ['ขอบเขต', scope.scopeLabel],
    ['วันที่ส่งออก', new Date().toLocaleString('th-TH')],
    ['ระดับความเสี่ยงรวม', t.label],
    ['คำแนะนำ', t.guidance],
    [],
    ['นักเรียนทั้งหมด', scope.summary.totalStudents],
    ['ส่งแบบประเมินแล้ว', scope.summary.totalDone],
    ['กลุ่มเฝ้าระวัง', scope.summary.totalAtRisk],
    ['กลุ่มวิกฤต', scope.summary.totalCritical],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'สรุป');

  if (scope.progress.length > 1) {
    const progRows = [['ห้อง', 'นักเรียนทั้งหมด', 'ส่งแล้ว', 'ค้างส่ง', 'เปอร์เซ็นต์']];
    scope.progress.forEach(p => progRows.push([p.class, p.total, p.done, p.total - p.done, p.percent + '%']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(progRows), 'ความคืบหน้ารายห้อง');
  }

  const caseRows = [['รหัส','ชื่อ-นามสกุล','ห้อง','เลขที่','PHQ-A สถานะ','PHQ-A คะแนน','ST5 สถานะ','ST5 คะแนน','GAD-2 สถานะ','GAD-2 คะแนน','สังคม','8Q สถานะ','8Q คะแนน','ผลประเมินรวม','วิกฤต','วันที่ทำแบบประเมิน']];
  list.forEach(r => caseRows.push([r.id, r.name, r.class, r.number, r.phqaStatus, r.phqaScore, r.st5Status, r.st5Score, r.gad2Status, r.gad2Score, r.socStatus, r.q8Status, r.q8Score, r.overall, r.isCritical ? 'ใช่' : '-', r.timestamp]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(caseRows), 'รายชื่อกลุ่มเสี่ยง');

  const filenameSafe = scope.scopeLabel.replace(/[^a-zA-Zก-๙0-9]/g, '_');
  XLSX.writeFile(wb, `รายงานสุขภาพจิต_${filenameSafe}.xlsx`);
}
