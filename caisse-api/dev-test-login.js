// dev-test-login.js
async function main() {
  const email = 'fabien.hicauber@gmail.com';
  const password = 'admin123!';

  console.log('Test login avec :', email, password);

  const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const js = await res.json().catch(() => ({}));
  console.log('Status HTTP =', res.status);
  console.log('Réponse JSON =', js);
}

main().catch(err => {
  console.error('Erreur dev-test-login:', err);
});
