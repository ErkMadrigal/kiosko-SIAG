import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { KioskoAuthService } from './services/kiosko-auth.service';

const authGuard = () => {
  const auth   = inject(KioskoAuthService);
  const router = inject(Router);
  if (auth.estaAutenticado()) return true;
  return router.createUrlTree(['/login']);
};

const guestGuard = () => {
  const auth   = inject(KioskoAuthService);
  const router = inject(Router);
  if (!auth.estaAutenticado()) return true;
  return router.createUrlTree(['/home']);
};

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'scanner-login',
    loadComponent: () =>
      import('./pages/scanner-login/scanner-login.page').then(m => m.ScannerLoginPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/home/Home.page').then(m => m.HomePage),
  },
  {
    path: 'scanner',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/scanner/Scanner.page').then(m => m.ScannerPage),
  },
  // ── Vista de pruebas TensorFlow — solo empleado 178 ──────────────
  {
    path: 'scanner-tf',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/scanner-tf/scanner-tf.page').then(m => m.ScannerTfPage),
  },
  // NUEVO -- enrolamiento facial (2 capturas), antes de poder usar scanner-tf
  {
    path: 'enrolamiento',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/enrolamiento/enrolamiento.page').then(m => m.EnrolamientoPage),
  },
  {
    path: 'resultado',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/resultado/Resultado.page').then(m => m.ResultadoPage),
  },
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup/setup.page').then( m => m.SetupPage)
  },
  {
    path: '**',
    redirectTo: 'login',
  },

];
