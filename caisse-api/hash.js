import bcrypt from 'bcrypt';
const password = 'Lagargutte@40140';
const saltRounds = 10;

bcrypt.hash(password, saltRounds, function(err, hash) {
  if (err) throw err;
  console.log('Hash:', hash);
});