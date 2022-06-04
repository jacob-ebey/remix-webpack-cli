import * as React from "react";
import type { MetaFunction } from "@remix-run/node";
import {
  Link,
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "@remix-run/react";

import Counter from "./components/counter";

import paperStylesHref from "./styles/paper.css";

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "New Remix App",
  viewport: "width=device-width,initial-scale=1",
});

export default function App() {
  let location = useLocation();

  return (
    <html lang="en">
      <head>
        <Meta />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://unpkg.com/nprogress@0.2.0/nprogress.css"
          as="style"
        />
        <link
          rel="preload"
          href="https://fonts.gstatic.com/s/neucha/v17/q5uGsou0JOdh94bfvQltKRZUgQ.woff2"
          crossOrigin="anonymous"
          as="font"
        />
        <Links />
        <link rel="stylesheet" href={paperStylesHref} />
        <link
          href="https://fonts.googleapis.com/css2?family=Neucha"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/nprogress@0.2.0/nprogress.css"
        />
      </head>
      <body>
        <nav className="border split-nav">
          <div className="nav-brand">
            <h3>
              <Link to="/">remix-flags example</Link>
            </h3>
          </div>
          <div className="collapsible">
            <input
              key={location.key}
              id="collapsibleMenuToggle"
              type="checkbox"
              name="collapsibleMenuToggle"
            />
            <label htmlFor="collapsibleMenuToggle">Menu</label>
            <div className="collapsible-body">
              <ul className="inline">
                <li>
                  <Link to="/docs">Documentation</Link>
                </li>
              </ul>
            </div>
          </div>
        </nav>
        <Counter />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        {process.env.NODE_ENV === "development" ? <LiveReload /> : null}
      </body>
    </html>
  );
}
