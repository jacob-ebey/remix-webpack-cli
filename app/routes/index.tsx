import * as React from "react";
import { json } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";

import * as os from "os";

import Counter from "~/components/counter";

export let loader = () => {
  return json(`Hello, ${os.platform()}`);
};

export default function Index() {
  let message = useLoaderData();
  return (
    <main>
      <h1>{message}</h1>
      <Counter />
    </main>
  );
}
