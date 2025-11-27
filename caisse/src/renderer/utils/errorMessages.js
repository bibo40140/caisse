// src/renderer/utils/errorMessages.js

/**
 * Convertit les erreurs techniques en messages utilisateur compréhensibles
 */
function getUserFriendlyError(error, context = '') {
  const errorStr = String(error?.message || error || '').toLowerCase();
  
  // Erreurs réseau
  if (errorStr.includes('fetch') || errorStr.includes('network') || errorStr.includes('econnrefused')) {
    return {
      title: 'Problème de connexion',
      message: 'Impossible de contacter le serveur. Vérifiez votre connexion internet.',
      action: 'Réessayez dans quelques instants ou contactez le support.',
      type: 'network'
    };
  }
  
  // Erreurs d'authentification
  if (errorStr.includes('401') || errorStr.includes('unauthorized') || errorStr.includes('token')) {
    return {
      title: 'Session expirée',
      message: 'Votre session a expiré. Vous devez vous reconnecter.',
      action: 'Cliquez sur Déconnexion puis reconnectez-vous.',
      type: 'auth'
    };
  }
  
  // Erreurs serveur (500)
  if (errorStr.includes('500') || errorStr.includes('internal server')) {
    return {
      title: 'Erreur serveur',
      message: 'Le serveur rencontre un problème technique.',
      action: 'Si le problème persiste, contactez le support technique.',
      type: 'server'
    };
  }
  
  // Erreurs de syntaxe SQL/données
  if (errorStr.includes('syntax') || errorStr.includes('invalid input')) {
    return {
      title: 'Données invalides',
      message: 'Les données envoyées ne sont pas au bon format.',
      action: 'Cette erreur a été enregistrée. Contactez le support si elle persiste.',
      type: 'data'
    };
  }
  
  // Erreurs de conflit
  if (errorStr.includes('conflict') || errorStr.includes('duplicate')) {
    return {
      title: 'Conflit de données',
      message: 'Cette opération entre en conflit avec d\'autres données.',
      action: 'Rafraîchissez la page et réessayez.',
      type: 'conflict'
    };
  }
  
  // Timeout
  if (errorStr.includes('timeout') || errorStr.includes('timed out')) {
    return {
      title: 'Délai dépassé',
      message: 'L\'opération a pris trop de temps.',
      action: 'Vérifiez votre connexion et réessayez.',
      type: 'timeout'
    };
  }
  
  // Erreur de base de données locale
  if (errorStr.includes('sqlite') || errorStr.includes('database')) {
    return {
      title: 'Erreur base de données',
      message: 'Un problème est survenu avec la base de données locale.',
      action: 'Redémarrez l\'application. Si le problème persiste, contactez le support.',
      type: 'database'
    };
  }
  
  // Erreur générique
  return {
    title: context ? `Erreur ${context}` : 'Erreur',
    message: errorStr.length > 100 ? errorStr.substring(0, 100) + '...' : errorStr,
    action: 'Si le problème persiste, notez ce message et contactez le support.',
    type: 'unknown'
  };
}

/**
 * Affiche une erreur avec un toast amélioré
 */
function showError(error, context = '') {
  const friendly = getUserFriendlyError(error, context);
  
  // Si showToast existe, l'utiliser
  if (window.showToast) {
    const fullMessage = `${friendly.message}\n${friendly.action}`;
    window.showToast(fullMessage, 'error', 8000);
  } else {
    // Fallback sur alert
    alert(`${friendly.title}\n\n${friendly.message}\n\n${friendly.action}`);
  }
  
  // Logger l'erreur dans la console pour debug
  console.error(`[${friendly.type}] ${friendly.title}:`, error);
  
  return friendly;
}

/**
 * Affiche un message de succès
 */
function showSuccess(message, duration = 3000) {
  if (window.showToast) {
    window.showToast(message, 'success', duration);
  } else {
    // Pas d'alert pour les succès, juste console
    console.log('[SUCCESS]', message);
  }
}

/**
 * Affiche un avertissement
 */
function showWarning(message, duration = 5000) {
  if (window.showToast) {
    window.showToast(message, 'warning', duration);
  } else {
    console.warn('[WARNING]', message);
  }
}

// Export global pour utilisation dans toute l'app
if (typeof window !== 'undefined') {
  window.showError = showError;
  window.showSuccess = showSuccess;
  window.showWarning = showWarning;
  window.getUserFriendlyError = getUserFriendlyError;
}
