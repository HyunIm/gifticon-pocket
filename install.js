(() => {
  'use strict';

  const installButton = document.getElementById('install-button');
  const registerButton = document.getElementById('header-register');
  const guide = document.getElementById('install-guide');
  const standalone = window.matchMedia('(display-mode: standalone)');
  const agent = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(agent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(agent);
  const isMacSafari = /Macintosh/.test(agent) && /Version\/\d+.*Safari\//.test(agent);
  const isChromium = /(?:Chrome|Chromium|Edg)\//.test(agent);
  let promptEvent;
  let installed = false;

  function updateInstallButton() {
    const canShowInstallation = promptEvent || isAppleMobile || isAndroid || isMacSafari || isChromium;
    const show = Boolean(canShowInstallation) && !installed && !standalone.matches && !navigator.standalone;
    installButton.hidden = !show;
    registerButton.hidden = show;
    if (!show && guide.open) guide.close();
  }

  function showGuide() {
    let instructions;
    if (isAppleMobile) {
      instructions = ['Safari에서 이 페이지를 열고 공유 버튼을 누르세요.',
        '‘홈 화면에 추가’를 선택하세요. ‘웹 앱으로 열기’가 보이면 켜고 ‘추가’를 누르세요.'];
    } else if (isMacSafari) {
      instructions = ['Safari의 파일 메뉴에서 ‘Dock에 추가’를 선택하세요.',
        '앱 이름을 확인하고 ‘추가’를 누르세요.'];
    } else if (isAndroid) {
      instructions = ['Chrome에서 이 페이지를 열고 브라우저 메뉴(⋮)를 누르세요.',
        '‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택하고 화면 안내를 따르세요.'];
    } else {
      instructions = ['주소창의 앱 설치 아이콘을 선택하세요.',
        '아이콘이 보이지 않으면 브라우저 메뉴에서 이 페이지를 앱으로 설치하는 항목을 선택하세요.'];
    }
    const steps = instructions.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    });
    document.getElementById('install-steps').replaceChildren(...steps);
    if (!guide.open) guide.showModal();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    updateInstallButton();
  });

  installButton.addEventListener('click', async () => {
    if (!promptEvent) {
      showGuide();
      return;
    }
    const currentPrompt = promptEvent;
    promptEvent = undefined;
    installButton.disabled = true;
    try {
      await currentPrompt.prompt();
      const choice = await currentPrompt.userChoice;
      if (choice.outcome === 'accepted') installed = true;
    } catch {
      showGuide();
    } finally {
      installButton.disabled = false;
      updateInstallButton();
    }
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = undefined;
    updateInstallButton();
  });
  standalone.addEventListener('change', updateInstallButton);
  updateInstallButton();

  const offlineNotice = document.getElementById('offline-notice');
  function updateConnection() {
    offlineNotice.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('오프라인 사용 준비에 실패했습니다.', error);
    });
  }
})();
