// src/main/auth/state.js
'use strict';
const jwt = require('jsonwebtoken');

let _token = null;
let _tenantId = null;
let _role = 'user';
let _isSuper = false;
let _userId = null;
let _email = null;

function _decode(t) {
  try { return jwt.decode(t) || {}; } catch { return {}; }
}

function set({ token, tenant_id, role, is_super_admin } = {}) {
  if (token) _token = token;
  const p = _decode(_token);

  _tenantId = tenant_id ?? p.tenant_id ?? null;
  _role = role ?? p.role ?? 'user';
  _isSuper = (is_super_admin ?? p.is_super_admin ?? false) || _role === 'super_admin';
  _userId = p.user_id ?? p.sub ?? null;
  _email = p.email ?? null;
}

function get() {
  return {
    token: _token,
    tenant_id: _tenantId,
    role: _role,
    is_super_admin: _isSuper,
    user_id: _userId,
    email: _email,
  };
}

function getTenantId() { return _tenantId; }
function getToken() { return _token; }

function clear() {
  _token = null;
  _tenantId = null;
  _role = 'user';
  _isSuper = false;
  _userId = null;
  _email = null;
}

module.exports = { set, get, getTenantId, getToken, clear };
