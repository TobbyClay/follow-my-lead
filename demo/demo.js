const customers = [
  { name: "Maya Chen", company: "Cedar Studio", email: "maya@example.test" },
  { name: "Noah Silva", company: "Fieldwork Labs", email: "noah@example.test" },
  { name: "Amara Costa", company: "Northstar Design", email: "amara@example.test" }
];
document.getElementById("search-form").addEventListener("submit", event => {
  event.preventDefault();
  const query = document.getElementById("customer-name").value.trim().toLowerCase();
  document.getElementById("result-count").textContent = "Searching…";
  setTimeout(() => {
    const results = query ? customers.filter(customer => customer.name.toLowerCase().includes(query)) : [];
    document.getElementById("result-count").textContent = `${results.length} ${results.length === 1 ? "customer" : "customers"} found`;
    document.getElementById("customers").replaceChildren(...results.map(customer => {
      const card = document.createElement("article"); card.className = "customer";
      for (const [tag, value] of [["h4", customer.name], ["p", customer.company], ["p", customer.email]]) { const item = document.createElement(tag); item.textContent = value; card.append(item); }
      return card;
    }));
  }, 250);
});
document.getElementById("change-layout").onclick = () => document.body.classList.toggle("shifted");
