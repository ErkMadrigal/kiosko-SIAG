import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    const token = localStorage.getItem('access_token') || '';
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    });
  }

  get<T>(path: string, params?: any): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, {
      headers: this.headers(),
      params,
    });
  }

  post<T>(path: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body, {
      headers: this.headers(),
    });
  }

  postFormData<T>(path: string, form: FormData): Observable<T> {
    const token = localStorage.getItem('access_token') || '';
    return this.http.post<T>(`${this.base}${path}`, form, {
      headers: new HttpHeaders({ 'Authorization': `Bearer ${token}` }),
    });
  }
}
