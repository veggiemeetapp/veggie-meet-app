import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type NativeImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onLoad" | "onError" | "className"
>;

interface ProgressiveImageProps extends NativeImageProps {
  src: string;
  fallbackSrc?: string;
  fallback?: ReactNode;
  containerClassName?: string;
  imageClassName?: string;
  /** Local previews are already available and should never flash a skeleton. */
  immediate?: boolean;
}

/**
 * WO-151 — shared content-image lifecycle. The container owns final geometry;
 * the decorative skeleton sits behind the image and disappears after decode.
 * A keyed cycle ensures source changes cannot retain stale loaded/error state.
 */
export function ProgressiveImage(props: ProgressiveImageProps) {
  return <ProgressiveImageCycle key={props.src} {...props} />;
}

function ProgressiveImageCycle({
  src,
  fallbackSrc,
  fallback,
  containerClassName,
  imageClassName,
  immediate = false,
  alt = "",
  ...imgProps
}: ProgressiveImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [activeSrc, setActiveSrc] = useState(src);
  const [loaded, setLoaded] = useState(immediate);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);

  const showSkeleton = !loaded && !failed;

  return (
    <span
      className={cn("relative block overflow-hidden bg-muted", containerClassName)}
      data-image-state={failed ? "error" : loaded ? "loaded" : "loading"}
    >
      {showSkeleton ? (
        <span className="image-shimmer absolute inset-0" aria-hidden="true" />
      ) : null}
      {failed ? (
        <span className="absolute inset-0" aria-hidden={alt === "" ? "true" : undefined}>
          {fallback}
        </span>
      ) : (
        <img
          {...imgProps}
          ref={imageRef}
          src={activeSrc}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (fallbackSrc && activeSrc !== fallbackSrc) {
              setLoaded(false);
              setActiveSrc(fallbackSrc);
              return;
            }
            setFailed(true);
          }}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200 ease-out motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
            imageClassName,
          )}
        />
      )}
    </span>
  );
}