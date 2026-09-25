import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { provideHttpClient } from '@angular/common/http'; // ← agregar
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader'; // ← agregar (sqlite en navegador)

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

// Registra el custom element <jeep-sqlite> que ya agregamos en
// index.html -- necesario para que @capacitor-community/sqlite
// funcione cuando corres la app en el navegador (ng serve). En
// Android/iOS nativo esto no hace nada (el plugin usa SQLite del SO).
jeepSqlite(window);

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideHttpClient(), // ← agregar
  ],
});
