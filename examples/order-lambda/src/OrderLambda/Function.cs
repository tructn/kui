using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon.Lambda.Core;
using Amazon.Lambda.KafkaEvents;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace OrderLambda;

/// <summary>An order as KUI's demo topic `demo.orders` holds it.</summary>
public record Order(
    [property: JsonPropertyName("orderId")] string OrderId,
    [property: JsonPropertyName("customer")] string Customer,
    [property: JsonPropertyName("total")] decimal Total,
    [property: JsonPropertyName("status")] string Status);

public record ProcessedOrder(string OrderId, string Customer, decimal Total, string Status, string Decision, string? Source);

public class Function
{
    /// <summary>Orders above this are refused, so the demo shows a function error in KUI.</summary>
    public const decimal ReviewLimit = 450m;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    /// <summary>
    /// For KUI's "AWS MSK event" payload, and for a real MSK trigger: the same code runs in both.
    /// </summary>
    public IReadOnlyList<ProcessedOrder> HandleMsk(KafkaEvent kafkaEvent, ILambdaContext context)
    {
        var processed = new List<ProcessedOrder>();
        foreach (var record in kafkaEvent.Records.SelectMany(batch => batch.Value))
        {
            var text = Encoding.UTF8.GetString(record.Value.ToArray());
            context.Logger.LogInformation($"{record.Topic}[{record.Partition}]@{record.Offset}: {text}");
            var order = Parse(text);
            processed.Add(Decide(order, $"{record.Topic}-{record.Partition}@{record.Offset}"));
        }
        return processed;
    }

    /// <summary>For KUI's "Message value" payload: the order JSON itself.</summary>
    public ProcessedOrder HandleRaw(Order order, ILambdaContext context)
    {
        context.Logger.LogInformation($"Raw order {order.OrderId}");
        return Decide(order, source: null);
    }

    public static Order Parse(string json) =>
        JsonSerializer.Deserialize<Order>(json, Json)
        ?? throw new InvalidDataException("The message value is null, not an order");

    public static ProcessedOrder Decide(Order order, string? source)
    {
        if (order.Total > ReviewLimit)
        {
            throw new InvalidOperationException(
                $"Order {order.OrderId} totals {order.Total}, over the {ReviewLimit} review limit");
        }
        var decision = order.Status switch
        {
            "NEW" => "charge",
            "PAID" => "ship",
            "SHIPPED" => "done",
            _ => "ignore",
        };
        return new ProcessedOrder(order.OrderId, order.Customer, order.Total, order.Status, decision, source);
    }
}
