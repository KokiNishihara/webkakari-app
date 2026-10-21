// 画面の小さな動き（入力欄・写真の添付・進みぐあいの自動更新など）
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // パスワードを表示する
  $$('[data-toggle-pw]').forEach((cb) => cb.addEventListener('change', () => {
    cb.dataset.togglePw.split(',').forEach((id) => { const i = document.getElementById(id); if (i) i.type = cb.checked ? 'text' : 'password'; });
  }));

  // パスワードの決まりをその場で表示
  const pw = $('[data-pw]');
  if (pw) {
    const upd = () => {
      $('[data-rule="len"]').classList.toggle('ok', pw.value.length >= 8);
      $('[data-rule="mix"]').classList.toggle('ok', /[A-Za-z]/.test(pw.value) && /[0-9]/.test(pw.value));
    };
    pw.addEventListener('input', upd);
  }

  // 依頼の入力欄
  const form = $('[data-composer]');
  if (form) {
    const ta = $('[data-text]', form), send = $('.send', form), file = $('[data-file]', form), thumb = $('[data-thumb]', form);
    let image = null;
    const ready = () => { send.disabled = !(ta.value.trim() || image); };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; };
    ta.addEventListener('input', () => { grow(); ready(); });
    $$('[data-chip]').forEach((b) => b.addEventListener('click', () => {
      ta.value = b.dataset.chip + '。'; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); grow(); ready();
    }));
    $$('[data-focus-composer]').forEach((b) => b.addEventListener('click', () => { ta.focus(); ta.scrollIntoView({ block: 'center' }); }));

    // 写真は端末側で長辺1600pxに縮めてから送る（通信量とサーバー負担を減らす）
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      image = cv.toDataURL('image/jpeg', 0.85);
      $('img', thumb).src = image; thumb.hidden = false; ready();
    });
    $('[data-unattach]', form).addEventListener('click', () => { image = null; file.value = ''; thumb.hidden = true; ready(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (send.disabled) return;
      send.disabled = true;
      try {
        const res = await fetch(form.getAttribute('action'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ta.value.trim(), image }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '送れませんでした');
        location.href = data.redirect;
      } catch (err) {
        alert(err.message + '\n通信が不安定な場合は、少し待ってからもう一度お送りください。');
        send.disabled = false;
      }
    });
    ready();
  }

  // 作成中は数秒ごとに進みぐあいを確認し、終わったら画面を更新
  const poll = $('[data-poll]');
  if (poll) {
    const tick = async () => {
      try { const r = await fetch(poll.dataset.poll); const d = await r.json(); if (d.status !== 'working') return location.reload(); } catch {}
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }

  // 管理：リンクをコピー
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const i = $('[data-copy-src]', b.parentElement); i.select();
    try { await navigator.clipboard.writeText(i.value); b.textContent = 'コピーしました'; } catch { document.execCommand('copy'); }
  }));

  // 管理：HTMLファイルを読み込んで送る
  const up = $('[data-html-upload]');
  if (up) up.addEventListener('submit', async (e) => {
    const f = $('[data-upload-html]', up).files[0];
    if (!f) { e.preventDefault(); alert('HTMLファイルを選んでください'); return; }
    if (!up.dataset.ready) {
      e.preventDefault();
      const buf = new Uint8Array(await f.arrayBuffer());
      let s = ''; buf.forEach((b) => { s += String.fromCharCode(b); });
      up.html_b64.value = btoa(s); up.dataset.ready = '1'; up.submit();
    }
  });
})();
