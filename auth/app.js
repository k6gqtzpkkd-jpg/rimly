const btn = document.getElementById('btn-auth');
const status = document.getElementById('status');

// Helper to base64 encode/decode
function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function unlockSystem() {
  btn.classList.add('scanning');
  status.textContent = '認証しています...';

  try {
    // Attempt to invoke local WebAuthn (Face ID / Touch ID)
    if (window.PublicKeyCredential) {
      // Create a dummy challenge just to trigger the native biometric prompt
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      // In a real secure app, this would use a registered credential.
      // For this PWA UX, we can just attempt to 'create' a dummy credential to trigger FaceID,
      // or if they have created one, 'get' it. We will just use 'create' with a random user if no key exists.
      
      let credentialId = localStorage.getItem('rimly_key_id');
      
      if (!credentialId) {
        // First time setup - create a passkey
        status.textContent = '初回セットアップ: Face IDを登録します...';
        const userId = new Uint8Array(16);
        window.crypto.getRandomValues(userId);
        
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge: challenge,
            rp: { name: "Rimly Key" },
            user: {
              id: userId,
              name: "admin",
              displayName: "Rimly Admin"
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 }
            ],
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              userVerification: "required"
            },
            timeout: 60000
          }
        });
        
        localStorage.setItem('rimly_key_id', bufferToBase64(cred.rawId));
      } else {
        // Authenticate using existing key
        status.textContent = 'Face IDでロック解除...';
        const credIdBuffer = Uint8Array.from(atob(credentialId), c => c.charCodeAt(0));
        await navigator.credentials.get({
          publicKey: {
            challenge: challenge,
            allowCredentials: [{ type: "public-key", id: credIdBuffer }],
            userVerification: "required"
          }
        });
      }
    } else {
      // Fallback for non-supported browsers
      await new Promise(r => setTimeout(r, 1000)); 
    }

    // Success! Send unlock signal to backend
    status.textContent = '解除信号を送信中...';
    
    // We get the target device DB key from URL params or use 'global_admin'
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKey = urlParams.get('key') || 'global_admin';

    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_auth',
        session_id: sessionKey,
        is_unlocked: true
      })
    });
    
    const json = await res.json();
    if (json.success) {
      status.textContent = '✅ REDMI PAD ロック解除成功！';
      status.classList.add('success-glow');
      btn.style.borderColor = '#00e676';
      btn.style.boxShadow = '0 0 40px rgba(0, 230, 118, 0.4)';
      document.querySelector('.face-id-icon').textContent = '✅';
      
      // Reset UI after 3 seconds
      setTimeout(() => {
        status.classList.remove('success-glow');
        status.textContent = '認証待機中...';
        btn.style.borderColor = '#FF6B00';
        btn.style.boxShadow = '0 0 30px rgba(255, 107, 0, 0.2)';
        document.querySelector('.face-id-icon').textContent = '🔓';
      }, 3000);
    } else {
      throw new Error("サーバー通信エラー");
    }

  } catch (err) {
    console.error(err);
    status.textContent = '❌ 認証失敗またはキャンセルされました';
  } finally {
    btn.classList.remove('scanning');
  }
}

btn.addEventListener('click', unlockSystem);

// Auto-trigger if 'auto=1' is in URL
if (new URLSearchParams(window.location.search).get('auto') === '1') {
  setTimeout(unlockSystem, 500);
}
