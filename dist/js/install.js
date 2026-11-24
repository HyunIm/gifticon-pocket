// Everything about running as an installed app: install prompts, in-app browser warnings,
// service worker registration and updates, and the offline notice.
import { $, el, showBanner } from './dom.js';
import { isStandalone } from './push.js';

const agent = navigator.userAgent;
const isAppleMobile = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(agent);
const isMacSafari = /Macintosh/.test(agent) && /Version\/\d+.*Safari\//.test(agent) && !isAppleMobile;
const isChromium = /(?:Chrome|Chromium|Edg)\//.test(agent);
const inApp = /KAKAOTALK/i.test(agent) ? 'kakao'
  : /\bLine\//.test(agent) ? 'line'
    : /NAVER\(inapp|DaumApps|Instagram|FBAN|FBAV|BAND\/|; wv\)/i.test(agent) ? 'other' : null;

const store = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

let promptEvent;
let installed = false;

export const canInstall = () => !installed && !isStandalone() && !inApp &&
  Boolean(promptEvent || isAppleMobile || isAndroid || isMacSafari || isChromium);

export function openInstallGuide() {
  const guide = $('#install-guide');
  let steps;
  if (isAppleMobile) {
    steps = ['Safari에서 이 페이지를 열고 아래쪽(또는 위쪽)의 공유 버튼을 누르세요.',
      '‘홈 화면에 추가’를 선택하세요. ‘웹 앱으로 열기’가 보이면 켜고 ‘추가’를 누르세요.',
      '이제 홈 화면의 기프티콘 포켓 아이콘으로 여세요. 쿠폰은 이 앱 안에 따로 보관돼요.'];
  } else if (isMacSafari) {
    steps = ['Safari의 파일 메뉴에서 ‘Dock에 추가’를 선택하세요.', '앱 이름을 확인하고 ‘추가’를 누르세요.'];
  } else if (isAndroid) {
    steps = ['Chrome에서 이 페이지를 열고 브라우저 메뉴(⋮)를 누르세요.',
      '‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택하고 화면 안내를 따르세요.'];
  } else {
    steps = ['주소창의 앱 설치 아이콘을 선택하세요.',
      '아이콘이 보이지 않으면 브라우저 메뉴에서 이 페이지를 앱으로 설치하는 항목을 선택하세요.'];
  }
  $('#install-steps').replaceChildren(...steps.map(text => el('li', '', text)));
  if (!guide.open) guide.showModal();
}

export async function promptInstall() {
  if (!promptEvent) { openInstallGuide(); return; }
  const current = promptEvent;
  promptEvent = undefined;
  try {
    await current.prompt();
    if ((await current.userChoice).outcome === 'accepted') installed = true;
  } catch {
    openInstallGuide();
  } finally {
    updateInstallButton();
  }
}

function updateInstallButton() {
  $('#install-button').hidden = !canInstall();
}

function warnInAppBrowser() {
  if (!inApp) return;
  const message = (inApp === 'kakao' ? '카카오톡 안의 브라우저로 열려 있어요.' : '앱 안의 브라우저로 열려 있어요.') +
    ' 여기에 등록한 쿠폰은 Safari·Chrome과 따로 보관되고 쉽게 지워질 수 있어요.';
  const external = inApp === 'kakao'
    ? () => { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href); }
    : inApp === 'line'
      ? () => { const url = new URL(location.href); url.searchParams.set('openExternalBrowser', '1'); location.href = url; }
      : async () => {
        try {
          await navigator.clipboard.writeText(location.origin);
          showBanner('in-app', '주소를 복사했어요. Safari나 Chrome 주소창에 붙여 넣어 여세요.', [['닫기', b => b.remove()]]);
        } catch {
          showBanner('in-app', `Safari나 Chrome에서 ${location.host} 을(를) 열어 주세요.`, [['닫기', b => b.remove()]]);
        }
      };
  showBanner('in-app', message, [[inApp === 'other' ? '주소 복사' : '다른 브라우저로 열기', external, true]], { tone: 'warn' });
}

const IOS_DISMISS_KEY = 'gifticon-pocket:ios-banner-dismissed';

function suggestHomeScreen() {
  if (!isAppleMobile || isStandalone() || inApp) return;
  const dismissed = Number(store.get(IOS_DISMISS_KEY) || 0);
  if (Date.now() - dismissed < 14 * 86400000) return;
  // Safari erases site data after 7 days without a visit; home screen apps are exempt.
  showBanner('ios', 'iPhone에서는 홈 화면에 추가해야 쿠폰이 지워지지 않고 만료 알림도 받을 수 있어요.', [
    ['추가 방법', () => openInstallGuide(), true],
    ['닫기', banner => { store.set(IOS_DISMISS_KEY, String(Date.now())); banner.remove(); }],
  ]);
}

function watchConnection() {
  const notice = $('#offline-notice');
  const update = () => { notice.hidden = navigator.onLine; };
  addEventListener('online', update);
  addEventListener('offline', update);
  update();
}

// isBusy(): true while the user is in the middle of something a reload would throw away.
async function registerServiceWorker(isBusy) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let requested = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (requested || !isBusy()) { reloading = true; location.reload(); return; }
    showBanner('update', '새 버전으로 업데이트됐어요. 작성을 마친 뒤 새로고침해 주세요.', [['새로고침', () => location.reload(), true]]);
  });
  const offer = worker => {
    showBanner('update', '새 버전이 준비됐어요.', [['업데이트', () => {
      requested = true;
      worker.postMessage({ type: 'skip-waiting' });
    }, true]]);
  };
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    // Installed apps can stay open for days; look for a new version whenever they come back.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  } catch (error) {
    console.warn('오프라인 사용 준비에 실패했습니다.', error);
  }
}

export function initShell({ isBusy }) {
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    updateInstallButton();
  });
  addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = undefined;
    updateInstallButton();
    $('#install-guide').close();
  });
  matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButton);
  $('#install-button').addEventListener('click', promptInstall);
  updateInstallButton();
  warnInAppBrowser();
  suggestHomeScreen();
  watchConnection();
  registerServiceWorker(isBusy);
}
