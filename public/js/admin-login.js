const form = document.querySelector('#admin-login-form');
const message = document.querySelector('#admin-login-message');

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const formData = new FormData(form);
    const email = formData.get('email');

    if (!email.endsWith('@febesol.de')) {
      message.textContent = 'Bitte eine @febesol.de Adresse eingeben.';
      return;
    }

    try {
      const response = await fetch(`/auth/microsoft/mock-login?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Mock-Login fehlgeschlagen.');
      }
      message.textContent = 'Anmeldung erfolgreich. Adminbereich wird geladen…';
      window.location.href = '/admin';
    } catch (error) {
      message.textContent = error.message;
    }
  });
}
