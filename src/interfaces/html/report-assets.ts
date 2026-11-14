export const styles = `
:root{color-scheme:light;--ink:#172e35;--muted:#475f68;--line:#c7d4d8;--accent:#005e70;--surface:#fff;--bg:#f1f5f5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--accent);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}a,button,input{touch-action:manipulation}button,input{font:inherit}button{cursor:pointer;background:#fff;color:var(--accent);border:1px solid #79949c;border-radius:6px;padding:7px 12px;min-height:42px}button:hover{background:#eaf4f5}input[type=search],input[type=text]{width:100%;min-width:0;border:1px solid #79949c;border-radius:6px;padding:10px;background:#fff;color:var(--ink)}input[type=checkbox]{width:19px;height:19px;accent-color:var(--accent)}:focus-visible{outline:3px solid #006d91;outline-offset:4px}[hidden]{display:none!important}.skip{position:absolute;left:12px;top:-80px;background:#fff;padding:12px;z-index:2}.skip:focus{top:12px}.wrap{width:min(1120px,100%);margin:auto;padding:32px 24px}header{border-top:6px solid var(--accent);background:#fff;border-bottom:1px solid var(--line)}header .wrap{padding-top:28px;padding-bottom:28px}.eyebrow{font-size:.8rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);margin:0 0 7px}h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.2;letter-spacing:-.035em;margin:0 0 14px}h2{font-size:1.45rem;line-height:1.3;margin:0 0 14px}h3{font-size:1.15rem;line-height:1.4;margin:0;overflow-wrap:anywhere}p{margin:8px 0 14px}.muted,small{color:var(--muted)}small{font-size:.85rem}.snapshot{display:inline-block;font-size:.8rem;border:1px solid #8ca8af;border-radius:4px;padding:2px 7px;font-weight:700;margin-right:8px}.notice{border-left:4px solid var(--accent);padding:4px 0 4px 14px;max-width:85ch}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:24px}.stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px}.stat strong{display:block;font-size:2rem;line-height:1.2;font-variant-numeric:tabular-nums;margin-bottom:6px}.stat span{font-size:.9rem}.scope{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:24px}summary{cursor:pointer;font-weight:650}dl{margin:14px 0 0}dt{font-size:.85rem;font-weight:700;color:var(--muted);margin-top:12px}dd{margin:2px 0 10px;min-width:0}code,.path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85rem;overflow-wrap:anywhere;white-space:pre-wrap}.path{display:block}.scope ul{padding-left:20px}.nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}.toolbar{padding:18px;background:#fff;border:1px solid var(--line);border-radius:8px;margin-bottom:14px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:16px;align-items:end}.search label{display:block;font-weight:650;margin-bottom:6px}.check{display:flex;align-items:center;gap:8px;min-height:44px;font-weight:600}.count{margin:10px 0 18px;color:var(--muted)}.cards{display:grid;gap:18px}.card{background:#fff;border:1px solid var(--line);border-radius:9px;padding:22px;min-width:0;scroll-margin-top:20px}.card:target{outline:3px solid #00788c;outline-offset:4px}.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.badge{display:inline-block;flex-shrink:0;font-size:.8rem;font-weight:750;line-height:1.4;padding:4px 8px;border-radius:4px;border:1px solid #80969c;color:#263f46;background:#edf3f4}.confirmed{color:#135c3d;background:#edf7f1;border-color:#76a88c}.unconfirmed,.changed{color:#794505;background:#fff6e6;border-color:#cba669}.invalid,.unreadable{color:#8a2228;background:#fff0f1;border-color:#cf8a91}.reason{white-space:pre-wrap;overflow-wrap:anywhere}.label{font-size:.8rem;font-weight:750;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.path-actions{margin:6px 0 12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.copy{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%}.copy input{flex-basis:100%}.copy-feedback{font-size:.85rem}.members{padding:0;list-style:none;margin:10px 0 0}.member{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px;padding:12px 0;border-top:1px solid #dce5e7}.member a{overflow-wrap:anywhere}.member .badge{margin-top:1px}.empty{border:1px dashed #8aa5ad;border-radius:8px;padding:24px;background:#fff}.errors{background:#fff1f2;border:1px solid #ce9196;border-radius:7px;padding:16px;margin:16px 0}.errors h2,.errors h3{font-size:1rem;margin-bottom:6px}.errors ul{padding-left:20px;margin:8px 0 0;overflow-wrap:anywhere}.file-section{margin-top:40px}.direct{padding-left:20px;margin-bottom:0}.direct li{margin:10px 0}.direct .path{margin-top:3px}.legend{font-size:.9rem;color:var(--muted);max-width:90ch;margin:0 0 20px}footer{border-top:1px solid var(--line);padding-top:20px;margin-top:32px;font-size:.9rem;color:var(--muted)}
@media(max-width:640px){.wrap{padding:24px 16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stat{padding:14px}.toolbar{grid-template-columns:1fr;gap:10px}.toolbar button{justify-self:start}.card{padding:16px}.card-head{display:block}.card-head .badge{margin-top:10px}.member{grid-template-columns:1fr;gap:6px}.member .badge{justify-self:start}.path-actions{gap:10px}.nav{gap:14px}}
@media(prefers-reduced-motion:no-preference){button,a{transition:background-color .12s}}
@media print{body{background:#fff}.toolbar,.copy,nav,.skip{display:none}.card{break-inside:avoid}.wrap{width:100%;padding:16px}.stats{grid-template-columns:repeat(4,1fr)}}
`;

// 利用者データは属性とテキストへescapeして渡し、実行コードには埋め込まない。
export const behavior = `
(() => {
  const groups = Array.from(document.querySelectorAll('[data-group]'));
  const search = document.getElementById('search');
  const attention = document.getElementById('attention');
  const shown = document.getElementById('shown');
  const reset = document.getElementById('reset');
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const group of groups) {
      group.hidden = !(group.dataset.search.toLocaleLowerCase().includes(query) && (!attention.checked || group.dataset.attention === 'true'));
      if (!group.hidden) visible++;
    }
    shown.textContent = visible + ' of ' + groups.length + ' groups shown' + (visible === 0 && groups.length ? '. No matching groups. Clear filters to see all groups.' : '.');
  }
  function clear() {
    search.value = '';
    attention.checked = false;
    filter();
  }
  search.addEventListener('input', filter);
  attention.addEventListener('change', filter);
  reset.addEventListener('click', () => { clear(); search.focus(); });
  for (const link of document.querySelectorAll('a[data-internal]')) {
    link.addEventListener('click', () => {
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (target) {
        if (target.hidden) clear();
        target.focus();
      }
    });
  }
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const input = button.parentElement.querySelector('input');
      const feedback = button.parentElement.querySelector('[data-copy-feedback]');
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        input.hidden = true;
        feedback.textContent = 'Copied.';
      } catch {
        input.hidden = false;
        input.focus();
        input.select();
        feedback.textContent = 'Select and copy this path. Clipboard access is unavailable.';
      }
    });
  }
  filter();
  const initial = document.getElementById(location.hash.slice(1));
  if (initial) initial.focus();
})();
`;
