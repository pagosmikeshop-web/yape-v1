"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MovementVoucher } from "./MovementVoucher";
import {
  fetchStoredMovements,
  groupStoredMovements,
  HISTORY_CLEARED_EVENT,
  MOVEMENT_HISTORY_CLEARED_KEY,
} from "./movement-history";
import { AssetIcon } from "./primitives";
import type {
  Movement,
  MovementHistoryGroup,
  MovementHistoryItem,
} from "./types";

function FullMovementsList({
  groups,
  onSelect,
}: {
  groups: MovementHistoryGroup[];
  onSelect: (movement: MovementHistoryItem) => void;
}) {
  return (
    <div className="reference-full-movements-list">
      {groups.map((group) => (
        <section className="reference-full-movement-group" key={group.month}>
          <h2 className="reference-full-movement-month">{group.month}</h2>
          {group.items.map((movement) => (
            <button
              className="reference-full-movement-item"
              type="button"
              key={movement.id}
              onClick={() => onSelect(movement)}
              aria-label={
                movement.name
                  ? `Ver movimiento de ${movement.name}`
                  : "Ver movimiento"
              }
            >
              <span className="reference-full-movement-info">
                <strong>{movement.name}</strong>
                <small>{movement.displayDate}</small>
              </span>
              <span
                className={
                  movement.amount < 0
                    ? "reference-full-movement-amount is-negative"
                    : "reference-full-movement-amount is-positive"
                }
              >
                {movement.amountLabel}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

export function MovementsView() {
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(
    null,
  );
  const [storedMovements, setStoredMovements] = useState<MovementHistoryItem[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    function refreshMovements() {
      void fetchStoredMovements()
        .then((result) => {
          if (cancelled) return;
          setStoredMovements(result.movements);
          window.localStorage.setItem(
            MOVEMENT_HISTORY_CLEARED_KEY,
            result.historyCleared ? "1" : "0",
          );
        })
        .catch(() => undefined);
    }
    refreshMovements();
    window.addEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    return () => {
      cancelled = true;
      window.removeEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    };
  }, []);

  if (selectedMovement) {
    return (
      <MovementVoucher
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />
    );
  }

  const storedGroups = groupStoredMovements(storedMovements);
  const visibleGroups = storedGroups;

  return (
    <div className="reference-movements-view">
      <header className="reference-movements-header">
        <Link
          href="/inicio"
          aria-label="Volver al inicio"
          className="reference-movements-back"
        >
          <AssetIcon name="ic_arrow_left_yape_on_primary" />
        </Link>
        <h1>Movimientos</h1>
        <span
          className="reference-movements-header-spacer"
          aria-hidden="true"
        />
      </header>
      {visibleGroups.length === 0 ? (
        <div className="cleared-movements-page">
          <AssetIcon name="ic_list_b_yape" />
          <strong>No tienes yapeos guardados</strong>
          <span>Los nuevos movimientos aparecerán aquí.</span>
        </div>
      ) : (
        <FullMovementsList
          groups={visibleGroups}
          onSelect={setSelectedMovement}
        />
      )}
    </div>
  );
}
