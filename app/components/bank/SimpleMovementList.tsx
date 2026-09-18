import { Money } from "./primitives";
import type { Movement } from "./types";

export function SimpleMovementList({
  items,
  onSelect,
}: {
  items: Movement[];
  onSelect?: (movement: Movement) => void;
}) {
  return (
    <div className="simple-movement-list">
      {items.map((movement) => {
        const content = (
          <>
            <span>
              <strong>{movement.name}</strong>
              <small>{movement.date}</small>
            </span>
            <Money value={movement.amount} />
          </>
        );

        return onSelect ? (
          <button
            className="simple-movement-item"
            type="button"
            key={movement.id}
            onClick={() => onSelect(movement)}
            aria-label={`Ver comprobante de ${movement.name}`}
          >
            {content}
          </button>
        ) : (
          <article className="simple-movement-item" key={movement.id}>
            {content}
          </article>
        );
      })}
    </div>
  );
}
