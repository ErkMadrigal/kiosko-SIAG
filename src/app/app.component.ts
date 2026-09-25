import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SyncService } from './services/sync.service';
import { SqliteService } from './services/sqlite.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor(private sync: SyncService, private sqlite: SqliteService) {
    // Inicializar SQLite -- SIEMPRE a través de SqliteService.init(), que
    // ya sabe esperar a que <jeep-sqlite> esté definido y abrir el web
    // store antes de tocar el plugin (en navegador). Antes esto creaba
    // una SQLiteConnection aparte y llamaba checkConnectionsConsistency()
    // de inmediato, sin esperar nada -- por eso tronaba con "jeep-sqlite
    // element is not present in the DOM" en cada arranque.
    this.sqlite.init()
      .then(() => console.log('[SQLite] OK'))
      .catch(err => console.error('[SQLite] Error:', err));

    // NUEVO -- antes este código existía en SyncService pero nadie lo
    // llamaba, así que las asistencias guardadas offline se quedaban
    // ahí para siempre hasta que alguien entrara manualmente a
    // Configuración y le diera "Subir ahora". Con esto, en cuanto el
    // kiosko recupera internet (o cada 5 min de todos modos, por si el
    // evento de red no se dispara) se suben solas.
    this.sync.iniciarMonitorRed();
    this.sync.iniciarReintentosPeriodicos(5);
  }
}
