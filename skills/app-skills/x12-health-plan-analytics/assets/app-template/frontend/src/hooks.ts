import { useEffect, useState } from "react";

export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export function useResource<T>(loader: () => Promise<T>, dependencies: unknown[]): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setResource({ data: null, loading: true, error: null });
    loader()
      .then((data) => active && setResource({ data, loading: false, error: null }))
      .catch((error: unknown) => {
        if (active) {
          setResource({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
    // The caller supplies a stable dependency list for each resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return resource;
}
