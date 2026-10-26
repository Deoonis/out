"""Точка входа: поднимает локальный сервер и открывает окно приложения (pywebview) или браузер."""
import sys
import time
import webbrowser

from jobassist.server import serve


def main():
    httpd = serve()
    url = f"http://127.0.0.1:{httpd.server_port}/"
    try:
        import webview
    except ImportError:
        webview = None
    if webview and "--browser" not in sys.argv:
        webview.settings["ALLOW_DOWNLOADS"] = True  # экспорт xlsx/json
        webview.create_window("Job Assist", url, width=1400, height=900, min_size=(1000, 680))
        webview.start()
        return
    print(f"Job Assist: {url}\nЗакройте окно, чтобы остановить.")
    webbrowser.open(url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
