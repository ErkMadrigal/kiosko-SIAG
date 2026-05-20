import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { KioskoAuthService } from './services/kiosko-auth.service';

// Guard — redirige al login si no hay sesión
const authGuard = () => {
  const auth   = inject(KioskoAuthService);
  const router = inject(Router);
  if (auth.estaAutenticado()) return true;
  return router.createUrlTree(['/login']);
};

// Guard — redirige al home si ya hay sesión
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
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'scanner',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/scanner/scanner.page').then(m => m.ScannerPage),
  },
  {
    path: 'resultado',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/resultado/resultado.page').then(m => m.ResultadoPage),
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
